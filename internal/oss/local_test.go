package oss

import (
	"bytes"
	"image"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/config"
)

func newLocalServer(t *testing.T) (*LocalStorage, string, func()) {
	t.Helper()
	tmp := t.TempDir()
	store, err := NewLocalStorage(config.OSSConfig{
		LocalDataDir:    tmp,
		LocalSigningKey: "unit-test-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	e := echo.New()
	store.RegisterRoutes(e)
	srv := httptest.NewServer(e)
	store.publicBaseURL = srv.URL
	return store, srv.URL, srv.Close
}

func TestLocalStorageEndToEnd(t *testing.T) {
	store, _, cleanup := newLocalServer(t)
	defer cleanup()

	key := "trips/1/raw/abc.jpg"
	// 1. Sign upload policy.
	policy, err := store.SignUploadPolicy(key, 0, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(policy.Host, "/api/_mock/oss/upload") {
		t.Fatalf("unexpected host: %s", policy.Host)
	}

	// 2. Upload via the mock endpoint using the policy.
	body, contentType := buildPostObject(t, policy, makeJPEG(t, 800, 600))
	req, _ := http.NewRequest(http.MethodPost, policy.Host, body)
	req.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload status %d", resp.StatusCode)
	}

	// 3. Object exists on disk.
	if ok, size, _ := store.HeadObject(key); !ok || size == 0 {
		t.Fatal("object not stored")
	}

	// 4. Sign GET URL with thumb processing.
	url, err := store.SignDownload(key, ImageProcess(VariantThumbWebP), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	r, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("download status %d", r.StatusCode)
	}
	data, _ := io.ReadAll(r.Body)
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 480 || img.Bounds().Dy() != 360 {
		t.Fatalf("unexpected size %v", img.Bounds())
	}

	// 5. Tampered signature → 403.
	tampered := strings.Replace(url, "sig=", "sig=deadbeef&old_sig=", 1)
	r, err = http.Get(tampered)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("tampered: expected 403, got %d", r.StatusCode)
	}

	// 6. Delete removes object.
	if err := store.DeleteObject(key); err != nil {
		t.Fatal(err)
	}
	if ok, _, _ := store.HeadObject(key); ok {
		t.Fatal("object still present after delete")
	}
}

func TestLocalStorageRejectsKeyMismatch(t *testing.T) {
	store, _, cleanup := newLocalServer(t)
	defer cleanup()

	policy, _ := store.SignUploadPolicy("trips/1/raw/legit.jpg", 0, time.Minute)
	// upload but with a different "key" form field
	body, ct := buildPostObjectWithKey(t, policy, "trips/1/raw/EVIL.jpg", []byte("hi"))
	req, _ := http.NewRequest(http.MethodPost, policy.Host, body)
	req.Header.Set("Content-Type", ct)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 400/403; got %d", resp.StatusCode)
	}
}

func TestLocalStorageExpiredPolicy(t *testing.T) {
	store, _, cleanup := newLocalServer(t)
	defer cleanup()

	policy, _ := store.SignUploadPolicy("trips/1/raw/x.jpg", 0, 500*time.Millisecond)
	time.Sleep(1500 * time.Millisecond)
	body, ct := buildPostObject(t, policy, []byte("data"))
	req, _ := http.NewRequest(http.MethodPost, policy.Host, body)
	req.Header.Set("Content-Type", ct)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for expired policy; got %d", resp.StatusCode)
	}
}

func buildPostObject(t *testing.T, p *UploadPolicy, file []byte) (io.Reader, string) {
	return buildPostObjectWithKey(t, p, p.Key, file)
}

func buildPostObjectWithKey(t *testing.T, p *UploadPolicy, key string, file []byte) (io.Reader, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range map[string]string{
		"key":                   key,
		"OSSAccessKeyId":        p.AccessKeyID,
		"policy":                p.Policy,
		"signature":             p.Signature,
		"success_action_status": "200",
		"Content-Type":          "image/jpeg",
	} {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fw, err := w.CreateFormFile("file", "x.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(file); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return &buf, w.FormDataContentType()
}
