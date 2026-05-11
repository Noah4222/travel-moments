package oss

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/config"
)

// LocalStorage stores objects on local disk and serves them via mock routes.
// Used when OSS is not configured (dev) and from tests.
type LocalStorage struct {
	dataDir       string
	publicBaseURL string // e.g. http://127.0.0.1:18888
	hmacKey       []byte
	processor     ImageProcessor
}

// ImageProcessor renders OSS image-process parameter against raw bytes.
// Returns processed bytes and the resulting Content-Type.
// May return original bytes/mime if processing is not supported.
type ImageProcessor func(raw []byte, srcMime, processSpec string) ([]byte, string)

func NewLocalStorage(cfg config.OSSConfig) (*LocalStorage, error) {
	dir := cfg.LocalDataDir
	if dir == "" {
		dir = "./data/oss"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	hmacKey := []byte(cfg.LocalSigningKey)
	if len(hmacKey) == 0 {
		// random per-process key. Survives restarts only if user sets LOCAL_SIGNING_KEY.
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		hmacKey = buf
	}
	return &LocalStorage{
		dataDir:       abs,
		publicBaseURL: strings.TrimRight(cfg.LocalPublicBaseURL, "/"),
		hmacKey:       hmacKey,
		processor:     defaultImageProcessor,
	}, nil
}

func (s *LocalStorage) Backend() string  { return "local" }
func (s *LocalStorage) DataDir() string  { return s.dataDir }
func (s *LocalStorage) BaseURL() string  { return s.publicBaseURL }

// ---- Storage interface ----

func (s *LocalStorage) SignDownload(key, process string, ttl time.Duration) (string, error) {
	return s.SignDownloadAttachment(key, process, "", ttl)
}

func (s *LocalStorage) SignDownloadAttachment(key, process, filename string, ttl time.Duration) (string, error) {
	if _, err := sanitizeKey(key); err != nil {
		return "", err
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	exp := time.Now().Add(ttl).Unix()
	tok := s.signToken(downloadPayload(key, process, exp))
	v := url.Values{}
	v.Set("exp", fmt.Sprintf("%d", exp))
	v.Set("sig", tok)
	if process != "" {
		v.Set("x-oss-process", process)
	}
	if filename != "" {
		v.Set("response-content-disposition", `attachment; filename="`+filename+`"`)
	}
	base := s.publicBaseURL
	return fmt.Sprintf("%s/api/_mock/oss/get/%s?%s", base, key, v.Encode()), nil
}

func (s *LocalStorage) SignUploadPolicy(key string, maxSize int64, ttl time.Duration) (*UploadPolicy, error) {
	if _, err := sanitizeKey(key); err != nil {
		return nil, err
	}
	if maxSize <= 0 {
		maxSize = 500 << 20
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	exp := time.Now().UTC().Add(ttl)

	doc := struct {
		Key     string `json:"key"`
		Expires int64  `json:"exp"`
		MaxSize int64  `json:"max"`
	}{Key: key, Expires: exp.Unix(), MaxSize: maxSize}
	raw, _ := json.Marshal(doc)
	policyB64 := base64.StdEncoding.EncodeToString(raw)
	sig := s.signToken(policyB64)

	host := s.publicBaseURL
	return &UploadPolicy{
		Host:          host + "/api/_mock/oss/upload",
		AccessKeyID:   "mock-access-key",
		Policy:        policyB64,
		Signature:     sig,
		Key:           key,
		ExpiresAt:     exp.Format(time.RFC3339),
		MaxSize:       maxSize,
		SuccessStatus: "200",
	}, nil
}

func (s *LocalStorage) HeadObject(key string) (bool, int64, error) {
	if _, err := sanitizeKey(key); err != nil {
		return false, 0, err
	}
	st, err := os.Stat(s.path(key))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, 0, nil
		}
		return false, 0, err
	}
	return true, st.Size(), nil
}

func (s *LocalStorage) DeleteObject(key string) error {
	if _, err := sanitizeKey(key); err != nil {
		return err
	}
	err := os.Remove(s.path(key))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// ---- mock HTTP routes ----

// RegisterRoutes mounts the mock OSS endpoints under the given group. Pass the
// root group (no auth middleware) — mock OSS routes must be public, just like
// real OSS.
func (s *LocalStorage) RegisterRoutes(e *echo.Echo) {
	g := e.Group("/api/_mock/oss")
	g.POST("/upload", s.handleUpload)
	g.GET("/get/*", s.handleDownload)
	g.HEAD("/get/*", s.handleDownload)
}

func (s *LocalStorage) handleUpload(c echo.Context) error {
	if err := c.Request().ParseMultipartForm(64 << 20); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid multipart")
	}
	form := c.Request().MultipartForm
	get := func(name string) string {
		if v := form.Value[name]; len(v) > 0 {
			return v[0]
		}
		return ""
	}
	policyB64 := get("policy")
	signature := get("signature")
	key := get("key")
	if policyB64 == "" || signature == "" || key == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "missing policy/signature/key")
	}
	if !s.verifyToken(policyB64, signature) {
		return echo.NewHTTPError(http.StatusForbidden, "bad signature")
	}
	raw, err := base64.StdEncoding.DecodeString(policyB64)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad policy")
	}
	var doc struct {
		Key     string `json:"key"`
		Expires int64  `json:"exp"`
		MaxSize int64  `json:"max"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad policy json")
	}
	if doc.Key != key {
		return echo.NewHTTPError(http.StatusBadRequest, "key mismatch")
	}
	if time.Now().Unix() > doc.Expires {
		return echo.NewHTTPError(http.StatusForbidden, "policy expired")
	}

	files := form.File["file"]
	if len(files) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "file required")
	}
	src, err := files[0].Open()
	if err != nil {
		return err
	}
	defer src.Close()

	if files[0].Size > doc.MaxSize {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "exceeds max_size")
	}

	dst := s.path(key)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, src); err != nil {
		return err
	}

	successStatus := get("success_action_status")
	if successStatus == "" {
		successStatus = "204"
	}
	switch successStatus {
	case "200":
		return c.NoContent(http.StatusOK)
	case "201":
		return c.NoContent(http.StatusCreated)
	default:
		return c.NoContent(http.StatusNoContent)
	}
}

func (s *LocalStorage) handleDownload(c echo.Context) error {
	key := strings.TrimPrefix(c.Request().URL.Path, "/api/_mock/oss/get/")
	if _, err := sanitizeKey(key); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	expStr := c.QueryParam("exp")
	sig := c.QueryParam("sig")
	process := c.QueryParam("x-oss-process")
	if sig == "" || expStr == "" {
		return echo.NewHTTPError(http.StatusForbidden, "missing token")
	}
	var exp int64
	fmt.Sscanf(expStr, "%d", &exp)
	if time.Now().Unix() > exp {
		return echo.NewHTTPError(http.StatusForbidden, "url expired")
	}
	expected := s.signToken(downloadPayload(key, process, exp))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return echo.NewHTTPError(http.StatusForbidden, "bad signature")
	}

	full := s.path(key)
	data, err := os.ReadFile(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "object not found")
		}
		return err
	}
	mime := mimeFromKey(key)
	if process != "" && s.processor != nil {
		out, outMime := s.processor(data, mime, process)
		if out != nil {
			data = out
			mime = outMime
		}
	}
	if disp := c.QueryParam("response-content-disposition"); disp != "" {
		c.Response().Header().Set("Content-Disposition", disp)
	}
	return c.Blob(http.StatusOK, mime, data)
}

// ---- helpers ----

func (s *LocalStorage) path(key string) string {
	return filepath.Join(s.dataDir, filepath.FromSlash(key))
}

func (s *LocalStorage) signToken(payload string) string {
	mac := hmac.New(sha256.New, s.hmacKey)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *LocalStorage) verifyToken(payload, sig string) bool {
	expected := s.signToken(payload)
	return hmac.Equal([]byte(sig), []byte(expected))
}

func downloadPayload(key, process string, exp int64) string {
	return fmt.Sprintf("%s\n%s\n%d", key, process, exp)
}

func mimeFromKey(key string) string {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".heic":
		return "image/heic"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".m3u8":
		return "application/vnd.apple.mpegurl"
	case ".ts":
		return "video/mp2t"
	}
	return "application/octet-stream"
}
