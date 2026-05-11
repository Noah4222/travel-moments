package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr      string
	PublicBaseURL        string // e.g. https://moments.example.com — for WebAuthn RP
	SiteName             string // e.g. Travel Moments — shown in passkey prompt
	WebAuthnExtraOrigins string // comma-separated additional WebAuthn RP origins

	DatabaseURL string

	JWTSecret    string
	JWTExpiresIn time.Duration

	OSS OSSConfig

	SignedURLTTL      time.Duration
	SignedURLCacheTTL time.Duration

	SeedAdminUsername string
	SeedAdminPassword string

	ShareSessionTTL time.Duration
	SecureCookies   bool
}

type OSSConfig struct {
	Backend         string // "aliyun" | "local" | "" (auto)
	Endpoint        string
	Bucket          string
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	UploadCallback  string
	MPSCallback     string

	// LocalStorage (mock) options.
	LocalDataDir       string
	LocalPublicBaseURL string
	LocalSigningKey    string

	// 阿里云 IMS 智能媒体服务 (HLS multi-bitrate transcoding) options.
	// Leave empty to keep mp4 fallback behavior (no real transcoding).
	IMSEndpoint        string // e.g. ice.cn-shanghai.aliyuncs.com
	IMSTemplateGroupID string // 转码模板组 ID，控制台创建后填入
	IMSCallbackSecret  string // 用于校验回调签名 (HMAC) 的共享密钥
	IMSHLSPrefix       string // 转码输出对象 key 前缀（默认 hls/）
}

func Load() (*Config, error) {
	cfg := &Config{
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		PublicBaseURL:        env("PUBLIC_BASE_URL", ""),
		SiteName:             env("SITE_NAME", "Travel Moments"),
		WebAuthnExtraOrigins: env("WEBAUTHN_EXTRA_ORIGINS", ""),
		DatabaseURL:       env("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:5432/travel_moments?sslmode=disable"),
		JWTSecret:         env("JWT_SECRET", "dev-secret-change-me"),
		JWTExpiresIn:      envDuration("JWT_EXPIRES_IN", 24*time.Hour),
		SignedURLTTL:      envDuration("SIGNED_URL_TTL", 10*time.Minute),
		SignedURLCacheTTL: envDuration("SIGNED_URL_CACHE_TTL", 9*time.Minute),
		SeedAdminUsername: env("SEED_ADMIN_USERNAME", "admin"),
		SeedAdminPassword: env("SEED_ADMIN_PASSWORD", ""),
		ShareSessionTTL:   envDuration("SHARE_SESSION_TTL", 4*time.Hour),
		SecureCookies:     envBool("SECURE_COOKIES", false),
		OSS: OSSConfig{
			Backend:            env("OSS_BACKEND", ""),
			Endpoint:           env("OSS_ENDPOINT", ""),
			Bucket:             env("OSS_BUCKET", ""),
			Region:             env("OSS_REGION", ""),
			AccessKeyID:        env("OSS_ACCESS_KEY_ID", ""),
			AccessKeySecret:    env("OSS_ACCESS_KEY_SECRET", ""),
			UploadCallback:     env("OSS_UPLOAD_CALLBACK_URL", ""),
			MPSCallback:        env("OSS_MPS_CALLBACK_URL", ""),
			LocalDataDir:       env("OSS_LOCAL_DATA_DIR", "./data/oss"),
			LocalPublicBaseURL: env("OSS_LOCAL_PUBLIC_BASE_URL", ""),
			LocalSigningKey:    env("OSS_LOCAL_SIGNING_KEY", ""),
			IMSEndpoint:        env("IMS_ENDPOINT", ""),
			IMSTemplateGroupID: env("IMS_TEMPLATE_GROUP_ID", ""),
			IMSCallbackSecret:  env("IMS_CALLBACK_SECRET", ""),
			IMSHLSPrefix:       env("IMS_HLS_PREFIX", "hls/"),
		},
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	return cfg, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		switch v {
		case "1", "true", "TRUE", "True", "yes":
			return true
		case "0", "false", "FALSE", "False", "no":
			return false
		}
	}
	return def
}

var _ = envInt
