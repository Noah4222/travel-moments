package settings

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/appsetting"
	"github.com/cloverstd/travel-moments/internal/oss"
)

// Keys recognised by the system.
const (
	KeyURLTTL          = "signed_url_ttl"           // duration string, e.g. "10m"
	KeyURLCacheTTL     = "signed_url_cache_ttl"     // duration string
	KeyUploadCacheCtl  = "upload_cache_control"     // Cache-Control header to apply on upload
	KeyAssetShareTTL   = "asset_share_default_ttl"  // single-asset share validity (e.g. "168h")
	KeyUploadConcurrency = "upload_concurrency"     // max parallel uploads per browser; default 5

	// OSS image-process strings (overrides). Empty → default from oss.ImageProcess.
	KeyImgThumbWebP   = "image_process_thumb_webp"
	KeyImgThumbAVIF   = "image_process_thumb_avif"
	KeyImgPreviewWebP = "image_process_preview_webp"
	KeyImgPreviewAVIF = "image_process_preview_avif"
	KeyImgCoverWebP   = "image_process_cover_webp"
	KeyImgCoverAVIF   = "image_process_cover_avif"
)

// variantKey maps a Variant to the setting key that overrides its process.
func variantKey(v oss.Variant) string {
	switch v {
	case oss.VariantThumbWebP:
		return KeyImgThumbWebP
	case oss.VariantThumbAVIF:
		return KeyImgThumbAVIF
	case oss.VariantPreviewWebP:
		return KeyImgPreviewWebP
	case oss.VariantPreviewAVIF:
		return KeyImgPreviewAVIF
	case oss.VariantCoverWebP:
		return KeyImgCoverWebP
	case oss.VariantCoverAVIF:
		return KeyImgCoverAVIF
	}
	return ""
}

// ImageProcessKeys lists the settings keys for OSS image-process overrides,
// in display order.
var ImageProcessKeys = []string{
	KeyImgThumbWebP,
	KeyImgThumbAVIF,
	KeyImgPreviewWebP,
	KeyImgPreviewAVIF,
	KeyImgCoverWebP,
	KeyImgCoverAVIF,
}

// Store wraps the app_setting table with an in-memory cache. Fall back to the
// config defaults when a key is not set.
type Store struct {
	db  *ent.Client
	cfg *config.Config

	mu    sync.RWMutex
	cache map[string]string
}

func New(db *ent.Client, cfg *config.Config) *Store {
	return &Store{db: db, cfg: cfg, cache: make(map[string]string)}
}

// Load preloads every persisted row.
func (s *Store) Load(ctx context.Context) error {
	rows, err := s.db.AppSetting.Query().All(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range rows {
		s.cache[r.Key] = r.Value
	}
	return nil
}

// Raw returns the stored value (or "" if unset).
func (s *Store) Raw(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache[key]
}

// All returns the merged effective settings (defaults + persisted overrides).
func (s *Store) All() map[string]string {
	m := map[string]string{
		KeyURLTTL:         s.URLTTL().String(),
		KeyURLCacheTTL:    s.URLCacheTTL().String(),
		KeyUploadCacheCtl: s.UploadCacheControl(),
		KeyAssetShareTTL:  s.AssetShareTTL().String(),
		KeyUploadConcurrency: strconv.Itoa(s.UploadConcurrency()),
	}
	for _, k := range ImageProcessKeys {
		m[k] = s.ImageProcessByKey(k)
	}
	return m
}

// ImageProcess returns the OSS image-process spec for the given variant,
// honoring the admin override if set, otherwise the built-in default.
func (s *Store) ImageProcess(v oss.Variant) string {
	if k := variantKey(v); k != "" {
		if raw := s.Raw(k); raw != "" {
			return raw
		}
	}
	return oss.ImageProcess(v)
}

func (s *Store) ImageProcessByKey(key string) string {
	if raw := s.Raw(key); raw != "" {
		return raw
	}
	switch key {
	case KeyImgThumbWebP:
		return oss.ImageProcess(oss.VariantThumbWebP)
	case KeyImgThumbAVIF:
		return oss.ImageProcess(oss.VariantThumbAVIF)
	case KeyImgPreviewWebP:
		return oss.ImageProcess(oss.VariantPreviewWebP)
	case KeyImgPreviewAVIF:
		return oss.ImageProcess(oss.VariantPreviewAVIF)
	case KeyImgCoverWebP:
		return oss.ImageProcess(oss.VariantCoverWebP)
	case KeyImgCoverAVIF:
		return oss.ImageProcess(oss.VariantCoverAVIF)
	}
	return ""
}

// Set persists key=value (or deletes when value=""), updating the cache.
func (s *Store) Set(ctx context.Context, key, value string) error {
	if value == "" {
		if _, err := s.db.AppSetting.Delete().
			Where(appsetting.KeyEQ(key)).
			Exec(ctx); err != nil {
			return err
		}
		s.mu.Lock()
		delete(s.cache, key)
		s.mu.Unlock()
		return nil
	}
	err := s.db.AppSetting.Create().
		SetKey(key).
		SetValue(value).
		OnConflictColumns(appsetting.FieldKey).
		UpdateValue().
		UpdateUpdatedAt().
		Exec(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()
	return nil
}

// ---- typed accessors ----

func (s *Store) URLTTL() time.Duration {
	if d, ok := s.duration(KeyURLTTL); ok {
		return d
	}
	if s.cfg != nil && s.cfg.SignedURLTTL > 0 {
		return s.cfg.SignedURLTTL
	}
	return 10 * time.Minute
}

func (s *Store) URLCacheTTL() time.Duration {
	if d, ok := s.duration(KeyURLCacheTTL); ok {
		return d
	}
	ttl := s.URLTTL()
	// cache TTL slightly less than url TTL
	if ttl > time.Minute {
		return ttl - time.Minute
	}
	return ttl
}

func (s *Store) UploadCacheControl() string {
	v := s.Raw(KeyUploadCacheCtl)
	if v != "" {
		return v
	}
	// Immutable since OSS keys are UUID-suffixed and never overwritten.
	return "public, max-age=31536000, immutable"
}

// UploadConcurrency returns the max parallel uploads the front-end should
// run for a single batch. Clamped to 1..32 to avoid pathological values.
func (s *Store) UploadConcurrency() int {
	v := s.Raw(KeyUploadConcurrency)
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 5
	}
	if n > 32 {
		return 32
	}
	return n
}

func (s *Store) AssetShareTTL() time.Duration {
	if d, ok := s.duration(KeyAssetShareTTL); ok {
		return d
	}
	return 7 * 24 * time.Hour
}

func (s *Store) duration(key string) (time.Duration, bool) {
	v := s.Raw(key)
	if v == "" {
		return 0, false
	}
	if d, err := time.ParseDuration(v); err == nil {
		return d, true
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		return time.Duration(n) * time.Second, true
	}
	return 0, false
}
