package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/ent/user"
	"github.com/cloverstd/travel-moments/internal/transcoder"
)

func jarred(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Jar: jar}
}

func jsonBody(t *testing.T, v any) io.Reader {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(b)
}

func hasCookie(r *http.Response, name string) bool {
	for _, c := range r.Cookies() {
		if c.Name == name {
			return true
		}
	}
	return false
}

func TestShareEndToEnd(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	tripID := createTrip(t, te, tok, "share-e2e")
	assetID := uploadFile(t, te, tok, tripID, "p.jpg", makeJPEG(t, 800, 600))

	// 1. Admin creates a share.
	r := te.doJSON("POST", fmt.Sprintf("/api/trips/%d/shares", tripID), tok, map[string]any{
		"note": "for alice",
	})
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create share: %d", r.StatusCode)
	}
	var sh struct {
		ID       int    `json:"id"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	mustDecode(t, r, &sh)
	if sh.Code == "" || sh.Password == "" {
		t.Fatal("share missing code/password")
	}

	// 2. Visitor authenticates with password.
	visitor := jarred(t)
	authResp, err := visitor.Post(
		te.srv.URL+"/api/public/shares/"+sh.Code+"/auth",
		"application/json",
		jsonBody(t, map[string]string{"password": sh.Password}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if authResp.StatusCode != http.StatusOK {
		t.Fatalf("share auth: %d", authResp.StatusCode)
	}
	if !hasCookie(authResp, "tm_share") {
		t.Fatal("share cookie not set")
	}
	authResp.Body.Close()

	// 3. Wrong password → 401.
	bad, _ := visitor.Post(
		te.srv.URL+"/api/public/shares/"+sh.Code+"/auth",
		"application/json",
		jsonBody(t, map[string]string{"password": "WRONG"}),
	)
	bad.Body.Close()
	if bad.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong pw: expected 401; got %d", bad.StatusCode)
	}

	// 4. Visitor lists scope.
	scopeR, err := visitor.Get(te.srv.URL + "/api/public/scope")
	if err != nil {
		t.Fatal(err)
	}
	if scopeR.StatusCode != http.StatusOK {
		t.Fatalf("scope: %d", scopeR.StatusCode)
	}
	var scope struct {
		TripID int `json:"trip_id"`
		Assets []struct {
			ID int `json:"id"`
		} `json:"assets"`
	}
	mustDecode(t, scopeR, &scope)
	if scope.TripID != tripID || len(scope.Assets) != 1 || scope.Assets[0].ID != assetID {
		t.Fatalf("scope mismatch: %+v", scope)
	}

	// 5. Visitor requests an asset URL → records AssetView.
	urlR, _ := visitor.Get(fmt.Sprintf("%s/api/public/assets/%d/url?variant=preview", te.srv.URL, assetID))
	urlR.Body.Close()
	if urlR.StatusCode != http.StatusOK {
		t.Fatalf("asset url: %d", urlR.StatusCode)
	}
	time.Sleep(200 * time.Millisecond) // async write

	// 6. Stats should show 1 visit + ≥1 asset view + 1 unique IP.
	statsR := te.do("GET", fmt.Sprintf("/api/shares/%d/stats", sh.ID), tok, nil, "")
	var stats struct {
		Visits     int `json:"visits"`
		UniqueIPs  int `json:"unique_ips"`
		AssetViews int `json:"asset_views"`
	}
	mustDecode(t, statsR, &stats)
	if stats.Visits != 1 || stats.AssetViews < 1 || stats.UniqueIPs != 1 {
		t.Fatalf("unexpected stats: %+v", stats)
	}

	// 7. Visitor forwards → child share with NEW password.
	fwd, _ := visitor.Post(
		te.srv.URL+"/api/public/forward",
		"application/json",
		jsonBody(t, map[string]string{"note": "alice → bob"}),
	)
	if fwd.StatusCode != http.StatusCreated {
		t.Fatalf("forward: %d", fwd.StatusCode)
	}
	var child struct{ Code, Password string }
	mustDecode(t, fwd, &child)
	if child.Code == sh.Code || child.Password == sh.Password {
		t.Fatal("child share must have new code/password")
	}

	// 8. Tree includes child.
	treeR := te.do("GET", fmt.Sprintf("/api/shares/%d/tree", sh.ID), tok, nil, "")
	var tree struct {
		Children []struct {
			Code string `json:"code"`
		} `json:"children"`
	}
	mustDecode(t, treeR, &tree)
	if len(tree.Children) != 1 || tree.Children[0].Code != child.Code {
		t.Fatalf("tree missing child: %+v", tree)
	}

	// 9. Cascade revoke parent → child rejected too.
	revR := te.do("POST", fmt.Sprintf("/api/shares/%d/revoke?cascade=true", sh.ID), tok, nil, "")
	revR.Body.Close()
	if revR.StatusCode != http.StatusOK {
		t.Fatalf("revoke: %d", revR.StatusCode)
	}
	bobClient := jarred(t)
	bobAuth, _ := bobClient.Post(
		te.srv.URL+"/api/public/shares/"+child.Code+"/auth",
		"application/json",
		jsonBody(t, map[string]string{"password": child.Password}),
	)
	bobAuth.Body.Close()
	if bobAuth.StatusCode != http.StatusGone {
		t.Fatalf("expected 410 after cascade revoke; got %d", bobAuth.StatusCode)
	}
}

func TestShareLazyVideoTranscode(t *testing.T) {
	te := newTestEnv(t)

	var calls atomic.Int32
	te.handler.Transcoder = &transcoder.FakeTranscoder{
		Delay: 50 * time.Millisecond,
		OnDone: func(r transcoder.Result) {
			calls.Add(1)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = te.client.Asset.UpdateOneID(r.AssetID).
				SetHlsStatus(asset.HlsStatusReady).
				SetHlsKey(r.HLSKey).
				Save(ctx)
		},
	}

	adminID := te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	tripID := createTrip(t, te, tok, "video-trip")

	a, err := te.client.Asset.Create().
		SetTripID(tripID).
		SetUploadedByID(adminID).
		SetKind(asset.KindVideo).
		SetOssKey("trips/1/raw/video/v.mp4").
		SetMime("video/mp4").
		SetSize(1000).
		SetSortOrder(1).
		Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if a.HlsStatus != asset.HlsStatusNone {
		t.Fatalf("expected HLS none; got %s", a.HlsStatus)
	}

	r := te.doJSON("POST", fmt.Sprintf("/api/trips/%d/shares", tripID), tok, map[string]any{})
	var sh struct{ Code, Password string }
	mustDecode(t, r, &sh)
	visitor := jarred(t)
	resp, _ := visitor.Post(
		te.srv.URL+"/api/public/shares/"+sh.Code+"/auth",
		"application/json",
		jsonBody(t, map[string]string{"password": sh.Password}),
	)
	resp.Body.Close()

	// First request: triggers transcode, returns mp4 fallback.
	first, _ := visitor.Get(fmt.Sprintf("%s/api/public/assets/%d/url?variant=video", te.srv.URL, a.ID))
	first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first url: %d", first.StatusCode)
	}

	// Wait for fake transcoder to complete.
	time.Sleep(300 * time.Millisecond)
	if calls.Load() != 1 {
		t.Fatalf("expected 1 transcode call; got %d", calls.Load())
	}

	updated, err := te.client.Asset.Get(t.Context(), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.HlsStatus != asset.HlsStatusReady {
		t.Fatalf("expected ready; got %s", updated.HlsStatus)
	}

	// Second request must not retrigger.
	second, _ := visitor.Get(fmt.Sprintf("%s/api/public/assets/%d/url?variant=video", te.srv.URL, a.ID))
	second.Body.Close()
	time.Sleep(150 * time.Millisecond)
	if calls.Load() != 1 {
		t.Fatalf("transcode re-invoked unexpectedly; calls=%d", calls.Load())
	}
}
