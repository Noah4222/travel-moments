package oss

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cloverstd/travel-moments/internal/config"
)

// Storage abstracts the object store. Two implementations exist: AliyunStorage
// (production) and LocalStorage (mock for dev/tests).
type Storage interface {
	// SignDownload returns a short-lived URL for the object with optional
	// processing parameter (e.g. image/resize,...).
	SignDownload(key, process string, ttl time.Duration) (string, error)

	// SignDownloadAttachment is like SignDownload but adds
	// Content-Disposition: attachment when filename is non-empty so the
	// browser saves the file with that name.
	SignDownloadAttachment(key, process, filename string, ttl time.Duration) (string, error)

	// SignUploadPolicy returns parameters the browser uses to PostObject
	// directly. The key MUST be exactly the one returned in the policy.
	SignUploadPolicy(key string, maxSize int64, ttl time.Duration) (*UploadPolicy, error)

	// DeleteObject removes the object. Best-effort.
	DeleteObject(key string) error

	// HeadObject returns whether the object exists and its size.
	HeadObject(key string) (exists bool, size int64, err error)

	// ProcessAndSaveAs runs the OSS image-process spec against srcKey and
	// writes the result to destKey (same bucket). Returns the size of the
	// resulting object so callers can update their DTOs.
	ProcessAndSaveAs(srcKey, processSpec, destKey string) (size int64, err error)

	// Backend label, useful for /health and logging.
	Backend() string
}

// UploadPolicy is what the frontend needs to PostObject directly.
type UploadPolicy struct {
	Host          string `json:"host"`
	AccessKeyID   string `json:"access_key_id"`
	Policy        string `json:"policy"`
	Signature     string `json:"signature"`
	Key           string `json:"key"`
	ExpiresAt     string `json:"expires_at"`
	MaxSize       int64  `json:"max_size_bytes"`
	SuccessStatus string `json:"success_action_status"`
	// CacheControl is the suggested value the browser should attach as a
	// "Cache-Control" form field when posting to OSS. The policy allows any
	// value (`starts-with $Cache-Control ""`), so the front-end may override.
	CacheControl string `json:"cache_control,omitempty"`
}

// New picks the right backend based on cfg.
//
//   - cfg.Backend == "local"     → LocalStorage (always)
//   - cfg.Backend == "aliyun"    → AliyunStorage (errors if creds missing)
//   - cfg.Backend == "" / "auto" → Aliyun if endpoint+bucket+creds provided,
//                                   else fall back to LocalStorage
func New(cfg config.OSSConfig) (Storage, error) {
	switch strings.ToLower(cfg.Backend) {
	case "local":
		return NewLocalStorage(cfg)
	case "aliyun":
		return NewAliyunStorage(cfg)
	case "", "auto":
		if cfg.Endpoint != "" && cfg.Bucket != "" && cfg.AccessKeyID != "" && cfg.AccessKeySecret != "" {
			return NewAliyunStorage(cfg)
		}
		return NewLocalStorage(cfg)
	default:
		return nil, fmt.Errorf("unknown OSS backend %q", cfg.Backend)
	}
}

var ErrNotConfigured = errors.New("OSS not configured")

func sanitizeKey(key string) (string, error) {
	if key == "" {
		return "", errors.New("empty key")
	}
	if strings.Contains(key, "..") || strings.HasPrefix(key, "/") {
		return "", errors.New("invalid key")
	}
	return key, nil
}
