package cache

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestSignedURLCacheHit(t *testing.T) {
	c := NewSignedURL(8, time.Hour)
	var calls atomic.Int32
	producer := func() (string, error) {
		calls.Add(1)
		return "https://example.com/x?sig=abc", nil
	}

	for i := 0; i < 10; i++ {
		got, err := c.GetOrSet("key1", producer)
		if err != nil {
			t.Fatalf("GetOrSet err: %v", err)
		}
		if got != "https://example.com/x?sig=abc" {
			t.Fatalf("unexpected url: %s", got)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("producer should be called once; got %d", calls.Load())
	}
}

func TestSignedURLCacheTTL(t *testing.T) {
	c := NewSignedURL(8, 50*time.Millisecond)
	var calls atomic.Int32
	producer := func() (string, error) {
		calls.Add(1)
		return "u", nil
	}
	if _, err := c.GetOrSet("k", producer); err != nil {
		t.Fatal(err)
	}
	time.Sleep(80 * time.Millisecond)
	if _, err := c.GetOrSet("k", producer); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 producer calls after TTL expiry; got %d", calls.Load())
	}
}

func TestSignedURLProducerError(t *testing.T) {
	c := NewSignedURL(8, time.Hour)
	if _, err := c.GetOrSet("k", func() (string, error) {
		return "", errors.New("boom")
	}); err == nil {
		t.Fatal("expected error")
	}
	// On error nothing should be cached.
	var calls atomic.Int32
	_, _ = c.GetOrSet("k", func() (string, error) {
		calls.Add(1)
		return "ok", nil
	})
	if calls.Load() != 1 {
		t.Fatalf("expected fresh call after prior error; got %d", calls.Load())
	}
}

func TestSignedURLInvalidate(t *testing.T) {
	c := NewSignedURL(8, time.Hour)
	for _, k := range []string{"a:1:thumb", "a:1:preview", "a:2:thumb"} {
		if _, err := c.GetOrSet(k, func() (string, error) { return k, nil }); err != nil {
			t.Fatal(err)
		}
	}
	c.Invalidate("a:1:")
	if got := c.Len(); got != 1 {
		t.Fatalf("expected 1 entry after invalidate; got %d", got)
	}
}
