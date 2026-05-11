package cache

import (
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2/expirable"
)

// SignedURL caches signed OSS URLs keyed by (asset_id, variant) within a TTL
// shorter than the URL's actual expiry.
type SignedURL struct {
	c   *lru.LRU[string, entry]
	ttl time.Duration
	mu  sync.Mutex
}

type entry struct {
	URL       string
	ExpiresAt time.Time
}

func NewSignedURL(size int, ttl time.Duration) *SignedURL {
	return &SignedURL{
		c:   lru.NewLRU[string, entry](size, nil, ttl),
		ttl: ttl,
	}
}

// GetOrSet returns the cached URL for key or invokes producer to populate it.
func (s *SignedURL) GetOrSet(key string, producer func() (string, error)) (string, error) {
	if v, ok := s.c.Get(key); ok && time.Now().Before(v.ExpiresAt) {
		return v.URL, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Re-check inside lock to avoid duplicate work under contention.
	if v, ok := s.c.Get(key); ok && time.Now().Before(v.ExpiresAt) {
		return v.URL, nil
	}
	url, err := producer()
	if err != nil {
		return "", err
	}
	s.c.Add(key, entry{URL: url, ExpiresAt: time.Now().Add(s.ttl)})
	return url, nil
}

func (s *SignedURL) Invalidate(prefix string) {
	for _, k := range s.c.Keys() {
		if len(prefix) == 0 || (len(k) >= len(prefix) && k[:len(prefix)] == prefix) {
			s.c.Remove(k)
		}
	}
}

func (s *SignedURL) Len() int { return s.c.Len() }
