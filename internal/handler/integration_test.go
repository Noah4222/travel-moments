package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/mattn/go-sqlite3"

	"database/sql"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/cache"
	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
	"github.com/cloverstd/travel-moments/internal/handler"
	"github.com/cloverstd/travel-moments/internal/oss"
	"github.com/cloverstd/travel-moments/internal/settings"
)

type testEnv struct {
	t       *testing.T
	srv     *httptest.Server
	client  *ent.Client
	store   *oss.LocalStorage
	handler *handler.Handler
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	// SQLite in-memory database with foreign keys.
	db, err := sql.Open("sqlite3", "file:ent?mode=memory&cache=shared&_fk=1")
	if err != nil {
		t.Fatal(err)
	}
	drv := entsql.OpenDB(dialect.SQLite, db)
	client := ent.NewClient(ent.Driver(drv))
	if err := client.Schema.Create(t.Context()); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{
		JWTSecret:         "test-secret",
		JWTExpiresIn:      time.Hour,
		SignedURLTTL:      5 * time.Minute,
		SignedURLCacheTTL: 4 * time.Minute,
		ShareSessionTTL:   time.Hour,
	}
	jwt := auth.NewJWT(cfg.JWTSecret, cfg.JWTExpiresIn)
	shareJWT := auth.NewShareJWT(cfg.JWTSecret)

	store, err := oss.NewLocalStorage(config.OSSConfig{
		LocalDataDir:    t.TempDir(),
		LocalSigningKey: "test-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	urlCache := cache.NewSignedURL(64, cfg.SignedURLCacheTTL)
	st := settings.New(client, cfg)
	_ = st.Load(t.Context())
	uploadJWT := auth.NewUploadJWT(cfg.JWTSecret)
	h := handler.New(handler.Deps{
		DB: client, JWT: jwt, ShareJWT: shareJWT, UploadJWT: uploadJWT,
		Cfg: cfg, OSS: store, SignedURLs: urlCache, Settings: st,
	})

	e := echo.New()
	e.HTTPErrorHandler = jsonErrorHandler
	store.RegisterRoutes(e)
	mountAPI(e, jwt, h)

	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)
	t.Cleanup(func() { _ = client.Close() })

	// Update LocalStorage publicBaseURL via reinit so signed URLs are absolute.
	storeWithBase, err := oss.NewLocalStorage(config.OSSConfig{
		LocalDataDir:       store.DataDir(),
		LocalSigningKey:    "test-key",
		LocalPublicBaseURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Replace store in handler so signed URLs include srv.URL.
	h.OSS = storeWithBase
	// And register the new store's routes? Same key/data dir so the existing
	// ones already serve files; only URL building needs the base.

	return &testEnv{t: t, srv: srv, client: client, store: storeWithBase, handler: h}
}

func mountAPI(e *echo.Echo, jwt *auth.JWT, h *handler.Handler) {
	api := e.Group("/api")
	api.Use(jwt.Middleware())
	api.Use(h.ShareJWT.Middleware())
	api.Use(h.UploadJWT.Middleware())
	api.POST("/auth/login", h.Login)
	api.GET("/auth/me", h.Me, auth.RequireUser)

	users := api.Group("/users", auth.RequireRole(auth.RoleAdmin))
	users.GET("", h.ListUsers)
	users.POST("", h.CreateUser)
	users.PATCH("/:id", h.UpdateUser)
	users.DELETE("/:id", h.DeleteUser)

	trips := api.Group("/trips", auth.RequireUser)
	trips.GET("", h.ListTrips)
	trips.GET("/:id", h.GetTrip)
	trips.GET("/:id/assets", h.ListAssets)
	tripsAdmin := api.Group("/trips", auth.RequireRole(auth.RoleAdmin))
	tripsAdmin.POST("", h.CreateTrip)
	tripsAdmin.POST("/:id/editors", h.AddEditor)

	api.POST("/upload/policy", h.UploadPolicy, h.RequireActiveUploadOrUser)
	api.POST("/upload/complete", h.UploadComplete, h.RequireActiveUploadOrUser)
	api.DELETE("/assets/:id", h.DeleteAsset, auth.RequireRole(auth.RoleAdmin))

	// Upload grants
	tripsAdmin.POST("/:id/upload-grants", h.CreateUploadGrant)
	trips.GET("/:id/upload-grants", h.ListUploadGrants)
	api.DELETE("/upload-grants/:id", h.RevokeUploadGrant, auth.RequireUser)
	api.GET("/upload-grants/:code/info", h.UploadGrantInfo)
	api.POST("/upload-grants/:code/consume", h.ConsumeUploadGrant)

	// Share + public routes
	trips.POST("/:id/shares", h.CreateTripShare)
	trips.GET("/:id/shares", h.ListTripShares)
	api.POST("/shares/:id/revoke", h.RevokeShare, auth.RequireUser)
	api.GET("/shares/:id/stats", h.ShareStats, auth.RequireUser)
	api.GET("/shares/:id/tree", h.ShareTree, auth.RequireUser)
	api.POST("/public/shares/:code/auth", h.AuthShare)
	pub := api.Group("/public", auth.RequireShareSession)
	pub.GET("/scope", h.PublicScope)
	pub.GET("/assets/:id/url", h.PublicAssetURL)
	pub.POST("/forward", h.PublicForward)
}

func jsonErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	code := http.StatusInternalServerError
	msg := err.Error()
	if he, ok := err.(*echo.HTTPError); ok {
		code = he.Code
		if m, ok := he.Message.(string); ok {
			msg = m
		}
	}
	_ = c.JSON(code, map[string]string{"message": msg})
}

// ---- helpers ----

func (te *testEnv) seedUser(role user.Role, username, password string) int {
	te.t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		te.t.Fatal(err)
	}
	u, err := te.client.User.Create().
		SetUsername(username).
		SetPasswordHash(hash).
		SetRole(role).
		Save(te.t.Context())
	if err != nil {
		te.t.Fatal(err)
	}
	return u.ID
}

func (te *testEnv) login(username, password string) string {
	te.t.Helper()
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		te.t.Fatal(err)
	}
	resp := te.do("POST", "/api/auth/login", "", bytes.NewReader(body), "application/json")
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		te.t.Fatalf("login %d", resp.StatusCode)
	}
	var out struct {
		Token string `json:"token"`
	}
	mustDecode(te.t, resp, &out)
	return out.Token
}

func (te *testEnv) do(method, path, token string, body io.Reader, contentType string) *http.Response {
	te.t.Helper()
	req, err := http.NewRequest(method, te.srv.URL+path, body)
	if err != nil {
		te.t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		te.t.Fatal(err)
	}
	return resp
}

func (te *testEnv) doJSON(method, path, token string, payload any) *http.Response {
	te.t.Helper()
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			te.t.Fatal(err)
		}
		body = bytes.NewReader(b)
	}
	return te.do(method, path, token, body, "application/json")
}

func mustDecode(t *testing.T, resp *http.Response, out any) {
	t.Helper()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("decode: %v body=%s", err, string(data))
	}
}

// ---- tests ----

func TestAuthAndUserCRUD(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw1234")

	tok := te.login("admin", "pw1234")

	// Create editor.
	resp := te.doJSON("POST", "/api/users", tok, map[string]string{
		"username": "alice", "password": "pw5678", "role": "editor",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create user %d", resp.StatusCode)
	}

	// List users.
	resp = te.do("GET", "/api/users", tok, nil, "")
	defer resp.Body.Close()
	var users []map[string]any
	mustDecode(t, resp, &users)
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}

	// Wrong password.
	respW := te.doJSON("POST", "/api/auth/login", "", map[string]string{
		"username": "admin", "password": "WRONG",
	})
	respW.Body.Close()
	if respW.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401; got %d", respW.StatusCode)
	}
}

func TestUploadFlowAndPermissions(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	adminTok := te.login("admin", "pw")

	// Admin creates a trip and uploads an image directly.
	tripA := createTrip(t, te, adminTok, "alpha")
	assetID := uploadFile(t, te, adminTok, tripA, "ok.jpg", makeJPEG(t, 1200, 800))
	if assetID == 0 {
		t.Fatal("expected asset id")
	}

	// List assets returns 1 with thumb URL.
	r := te.do("GET", fmt.Sprintf("/api/trips/%d/assets", tripA), adminTok, nil, "")
	var page struct {
		Assets     []map[string]any `json:"assets"`
		NextCursor *int             `json:"next_cursor"`
		Total      *int             `json:"total"`
	}
	mustDecode(t, r, &page)
	if len(page.Assets) != 1 {
		t.Fatalf("expected 1 asset; got %d", len(page.Assets))
	}
	urls := page.Assets[0]["urls"].(map[string]any)
	thumbObj, _ := urls["thumb"].(map[string]any)
	thumb, _ := thumbObj["webp"].(string)
	if thumb == "" {
		t.Fatalf("expected thumb.webp URL; urls=%+v", urls)
	}

	// Fetch the thumb — should be 480-wide JPEG.
	tr, err := http.Get(thumb)
	if err != nil {
		t.Fatal(err)
	}
	defer tr.Body.Close()
	if tr.StatusCode != http.StatusOK {
		t.Fatalf("thumb status %d", tr.StatusCode)
	}
	data, _ := io.ReadAll(tr.Body)
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 480 {
		t.Fatalf("thumb width %d, want 480", img.Bounds().Dx())
	}

	// Admin deletes — and OSS file is gone.
	r = te.do("DELETE", fmt.Sprintf("/api/assets/%d", assetID), adminTok, nil, "")
	r.Body.Close()
	if r.StatusCode != http.StatusNoContent {
		t.Fatalf("admin delete: %d", r.StatusCode)
	}
	r2, _ := http.Get(thumb)
	r2.Body.Close()
	if r2.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete; got %d", r2.StatusCode)
	}
}

func TestUploadGrantFlow(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	adminTok := te.login("admin", "pw")
	tripID := createTrip(t, te, adminTok, "grant-trip")

	// Admin creates a one-shot upload grant.
	r := te.doJSON("POST", fmt.Sprintf("/api/trips/%d/upload-grants", tripID), adminTok, map[string]any{
		"hours_ttl": 24,
		"note":      "for alice",
	})
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create grant: %d", r.StatusCode)
	}
	var grant struct {
		Code  string `json:"code"`
		Token string `json:"token"`
	}
	mustDecode(t, r, &grant)
	if grant.Code == "" || grant.Token == "" {
		t.Fatal("missing code/token")
	}

	// Visitor info before consume — status "ready".
	infoR := te.do("GET", fmt.Sprintf("/api/upload-grants/%s/info", grant.Code), "", nil, "")
	var info struct{ Status string }
	mustDecode(t, infoR, &info)
	if info.Status != "ready" {
		t.Fatalf("expected ready; got %s", info.Status)
	}

	// Wrong token → 401.
	bad := te.doJSON("POST", fmt.Sprintf("/api/upload-grants/%s/consume", grant.Code), "", map[string]string{"token": "WRONG"})
	bad.Body.Close()
	if bad.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: expected 401; got %d", bad.StatusCode)
	}

	// Correct token → upload JWT.
	good := te.doJSON("POST", fmt.Sprintf("/api/upload-grants/%s/consume", grant.Code), "", map[string]string{"token": grant.Token})
	if good.StatusCode != http.StatusOK {
		t.Fatalf("consume: %d", good.StatusCode)
	}
	var consumed struct {
		UploadToken string `json:"upload_token"`
		TripID      int    `json:"trip_id"`
	}
	mustDecode(t, good, &consumed)
	if consumed.UploadToken == "" || consumed.TripID != tripID {
		t.Fatalf("bad consume resp: %+v", consumed)
	}

	// Same code reuse must now fail (consumed).
	again := te.doJSON("POST", fmt.Sprintf("/api/upload-grants/%s/consume", grant.Code), "", map[string]string{"token": grant.Token})
	again.Body.Close()
	if again.StatusCode != http.StatusGone {
		t.Fatalf("expected 410 on second use; got %d", again.StatusCode)
	}

	// Use the upload token to upload.
	upTok := consumed.UploadToken
	t.Logf("uploadToken=%s tripID=%d", upTok[:30]+"...", tripID)
	assetID := uploadFile(t, te, upTok, tripID, "g.jpg", makeJPEG(t, 800, 600))
	if assetID == 0 {
		t.Fatal("upload via grant failed")
	}

	// Upload token must not work for a different trip.
	otherTrip := createTrip(t, te, adminTok, "other-trip")
	badUp := te.doJSON("POST", "/api/upload/policy", upTok, map[string]any{
		"trip_id": otherTrip, "filename": "x.jpg", "mime": "image/jpeg", "kind": "photo",
	})
	badUp.Body.Close()
	if badUp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-trip upload via grant: expected 403; got %d", badUp.StatusCode)
	}
}

func TestEditorLoginBlocked(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleEditor, "alice", "pw")
	r := te.doJSON("POST", "/api/auth/login", "", map[string]string{"username": "alice", "password": "pw"})
	r.Body.Close()
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("editor login should be 403; got %d", r.StatusCode)
	}
}

func TestSignedURLCacheReuse(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	tripID := createTrip(t, te, tok, "cache")
	uploadFile(t, te, tok, tripID, "a.jpg", makeJPEG(t, 800, 600))

	first := fetchAssetURLs(t, te, tok, tripID)
	second := fetchAssetURLs(t, te, tok, tripID)
	if first["thumb"] != second["thumb"] {
		t.Fatalf("expected cached thumb URL to be identical:\n  1=%s\n  2=%s",
			first["thumb"], second["thumb"])
	}
}

// ---- helpers ----

func createTrip(t *testing.T, te *testEnv, tok, slug string) int {
	t.Helper()
	r := te.doJSON("POST", "/api/trips", tok, map[string]string{
		"slug": slug, "title": slug,
	})
	defer r.Body.Close()
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create trip status %d", r.StatusCode)
	}
	var out struct{ ID int }
	mustDecode(t, r, &out)
	return out.ID
}

func uploadFile(t *testing.T, te *testEnv, tok string, tripID int, name string, content []byte) int {
	t.Helper()
	r := te.doJSON("POST", "/api/upload/policy", tok, map[string]any{
		"trip_id": tripID, "filename": name, "mime": "image/jpeg", "kind": "photo",
	})
	if r.StatusCode != http.StatusOK {
		t.Fatalf("policy %d", r.StatusCode)
	}
	var pol struct {
		Host                string `json:"host"`
		AccessKeyID         string `json:"access_key_id"`
		Policy              string `json:"policy"`
		Signature           string `json:"signature"`
		Key                 string `json:"key"`
		SuccessActionStatus string `json:"success_action_status"`
		OSSKey              string `json:"oss_key"`
	}
	mustDecode(t, r, &pol)

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	for k, v := range map[string]string{
		"key":                   pol.Key,
		"OSSAccessKeyId":        pol.AccessKeyID,
		"policy":                pol.Policy,
		"signature":             pol.Signature,
		"success_action_status": pol.SuccessActionStatus,
		"Content-Type":          "image/jpeg",
	} {
		_ = mw.WriteField(k, v)
	}
	fw, _ := mw.CreateFormFile("file", name)
	_, _ = fw.Write(content)
	mw.Close()
	upHost := pol.Host
	// Local mock host built with srv URL prefix; nothing else to munge.
	if !strings.HasPrefix(upHost, "http") {
		upHost = te.srv.URL + upHost
	}
	upReq, _ := http.NewRequest("POST", upHost, body)
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	up, err := http.DefaultClient.Do(upReq)
	if err != nil {
		t.Fatal(err)
	}
	up.Body.Close()
	if up.StatusCode != http.StatusOK {
		t.Fatalf("upload %d", up.StatusCode)
	}

	r = te.doJSON("POST", "/api/upload/complete", tok, map[string]any{
		"trip_id": tripID, "oss_key": pol.OSSKey, "kind": "photo", "mime": "image/jpeg",
		"size": len(content), "width": 1200, "height": 800,
	})
	defer r.Body.Close()
	if r.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(r.Body)
		t.Fatalf("complete %d: %s", r.StatusCode, string(body))
	}
	var out struct{ ID int }
	mustDecode(t, r, &out)
	return out.ID
}

func fetchAssetURLs(t *testing.T, te *testEnv, tok string, tripID int) map[string]string {
	t.Helper()
	r := te.do("GET", fmt.Sprintf("/api/trips/%d/assets", tripID), tok, nil, "")
	defer r.Body.Close()
	var page struct {
		Assets []struct {
			URLs struct {
				Thumb    map[string]string `json:"thumb"`
				Preview  map[string]string `json:"preview"`
				Download string            `json:"download"`
			} `json:"urls"`
		} `json:"assets"`
	}
	mustDecode(t, r, &page)
	if len(page.Assets) == 0 {
		t.Fatal("no assets")
	}
	return map[string]string{
		"thumb":    page.Assets[0].URLs.Thumb["webp"],
		"preview":  page.Assets[0].URLs.Preview["webp"],
		"download": page.Assets[0].URLs.Download,
	}
}

func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// silence unused import warnings when toggled
var _ = url.Parse
