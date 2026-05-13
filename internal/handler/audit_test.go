package handler_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/user"
)

func TestAuditEndpointsPermissions(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	editorID := te.seedUser(user.RoleEditor, "editor", "pw")
	// Editor accounts can't log in (blocked in production), so mint a JWT
	// directly to exercise the role-based middleware.
	editorTok, _, err := te.handler.JWT.Sign(editorID, string(user.RoleEditor))
	if err != nil {
		t.Fatal(err)
	}

	endpoints := []string{
		"/api/admin/audit/events",
		"/api/admin/audit/shares",
		"/api/admin/audit/trips",
		"/api/admin/audit/trips/1",
	}
	for _, p := range endpoints {
		// Anonymous
		r := te.do("GET", p, "", nil, "")
		r.Body.Close()
		if r.StatusCode != http.StatusUnauthorized {
			t.Errorf("anon %s: want 401, got %d", p, r.StatusCode)
		}
		// Editor
		r = te.do("GET", p, editorTok, nil, "")
		r.Body.Close()
		if r.StatusCode != http.StatusForbidden {
			t.Errorf("editor %s: want 403, got %d", p, r.StatusCode)
		}
	}
}

// ---- Task 2: AuditEvents tests ----

type auditEvent struct {
	VisitID        int       `json:"visit_id"`
	ShareID        int       `json:"share_id"`
	ShareCode      string    `json:"share_code"`
	TripID         int       `json:"trip_id"`
	TripTitle      string    `json:"trip_title"`
	IP             string    `json:"ip"`
	UA             string    `json:"ua"`
	Country        string    `json:"country"`
	Referer        string    `json:"referer"`
	VisitedAt      time.Time `json:"visited_at"`
	AssetViewCount int       `json:"asset_view_count"`
	IsShareCreator bool      `json:"is_share_creator"`
}

type auditEventsResp struct {
	Events       []auditEvent `json:"events"`
	NextBefore   *time.Time   `json:"next_before"`
	NextBeforeID *int         `json:"next_before_id"`
}

func TestAuditEventsPagination(t *testing.T) {
	te := newTestEnv(t)
	adminID := te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	trip, err := te.client.Trip.Create().
		SetSlug("trip-p").
		SetTitle("trip-p").
		SetCreatedByID(adminID).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	share, err := te.client.ShareLink.Create().
		SetScope(sharelink.ScopeTrip).
		SetTripID(trip.ID).
		SetCode("paginate1").
		SetPasswordHash("x").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	// Seed 60 visits. 3 of them share the same visited_at to exercise the
	// compound-cursor tie-break: if pagination only filters on visited_at < t,
	// these tied rows get silently dropped between pages.
	tieTime := base.Add(25 * time.Second)
	for i := 0; i < 60; i++ {
		visitedAt := base.Add(time.Duration(i) * time.Second)
		if i == 25 || i == 26 || i == 27 {
			visitedAt = tieTime
		}
		_, err := te.client.Visit.Create().
			SetShareID(share.ID).
			SetSessionID(fmt.Sprintf("sess-%d", i)).
			SetIP("9.9.9.9").
			SetVisitedAt(visitedAt).
			Save(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}

	r := te.do("GET", "/api/admin/audit/events", tok, nil, "")
	var page1 auditEventsResp
	mustDecode(t, r, &page1)
	r.Body.Close()
	if len(page1.Events) != 50 {
		t.Fatalf("page1: want 50 events, got %d", len(page1.Events))
	}
	if page1.NextBefore == nil {
		t.Fatalf("page1: want next_before, got nil")
	}
	if page1.NextBeforeID == nil {
		t.Fatalf("page1: want next_before_id, got nil")
	}
	// Visits should be newest-first.
	for i := 1; i < len(page1.Events); i++ {
		if page1.Events[i-1].VisitedAt.Before(page1.Events[i].VisitedAt) {
			t.Fatalf("page1: events not ordered desc at %d", i)
		}
	}

	seen := make(map[int]struct{}, 60)
	for _, e := range page1.Events {
		seen[e.VisitID] = struct{}{}
	}

	cursor := page1.NextBefore.Format(time.RFC3339Nano)
	url := fmt.Sprintf("/api/admin/audit/events?before=%s&before_id=%d", cursor, *page1.NextBeforeID)
	r2 := te.do("GET", url, tok, nil, "")
	var page2 auditEventsResp
	mustDecode(t, r2, &page2)
	r2.Body.Close()
	if len(page2.Events) != 10 {
		t.Fatalf("page2: want 10 events, got %d", len(page2.Events))
	}
	if page2.NextBefore != nil {
		t.Fatalf("page2: want nil next_before, got %v", page2.NextBefore)
	}
	if page2.NextBeforeID != nil {
		t.Fatalf("page2: want nil next_before_id, got %v", page2.NextBeforeID)
	}
	for _, e := range page2.Events {
		seen[e.VisitID] = struct{}{}
	}
	if len(seen) != 60 {
		t.Fatalf("expected 60 distinct visit IDs across both pages, got %d", len(seen))
	}
}

func TestAuditEventsFiltersAndFields(t *testing.T) {
	te := newTestEnv(t)
	adminID := te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	trip, err := te.client.Trip.Create().
		SetSlug("yunnan").
		SetTitle("云南").
		SetCreatedByID(adminID).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	share, err := te.client.ShareLink.Create().
		SetScope(sharelink.ScopeTrip).
		SetTripID(trip.ID).
		SetCode("abc123").
		SetPasswordHash("x").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()

	visitA, err := te.client.Visit.Create().
		SetShareID(share.ID).
		SetSessionID("sess-a").
		SetIP("1.1.1.1").
		SetUa("ua-a").
		SetVisitedAt(now.Add(-2 * time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Create an asset to attach views to (need a real asset for FK).
	a1, err := te.client.Asset.Create().
		SetTripID(trip.ID).
		SetUploadedByID(adminID).
		SetKind("photo").
		SetOssKey("trips/x/a1.jpg").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	a2, err := te.client.Asset.Create().
		SetTripID(trip.ID).
		SetUploadedByID(adminID).
		SetKind("photo").
		SetOssKey("trips/x/a2.jpg").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, aid := range []int{a1.ID, a2.ID} {
		if _, err := te.client.AssetView.Create().
			SetVisitID(visitA.ID).
			SetAssetID(aid).
			SetViewedAt(now.Add(-2 * time.Minute)).
			Save(ctx); err != nil {
			t.Fatal(err)
		}
	}

	visitB, err := te.client.Visit.Create().
		SetShareID(share.ID).
		SetSessionID("sess-b").
		SetIP("2.2.2.2").
		SetUa("ua-b").
		SetVisitedAt(now.Add(-1 * time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Child share whose creator is visit B.
	_, err = te.client.ShareLink.Create().
		SetScope(sharelink.ScopeTrip).
		SetTripID(trip.ID).
		SetCode("child001").
		SetPasswordHash("x").
		SetParentShareID(share.ID).
		SetCreatorVisitID(visitB.ID).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	// 1) ip filter → only B, is_share_creator=true.
	r := te.do("GET", "/api/admin/audit/events?ip=2.2.2.2", tok, nil, "")
	var ipResp auditEventsResp
	mustDecode(t, r, &ipResp)
	r.Body.Close()
	if len(ipResp.Events) != 1 {
		t.Fatalf("ip filter: want 1 event, got %d", len(ipResp.Events))
	}
	if ipResp.Events[0].VisitID != visitB.ID {
		t.Fatalf("ip filter: want visit B, got %d", ipResp.Events[0].VisitID)
	}
	if !ipResp.Events[0].IsShareCreator {
		t.Fatalf("ip filter: want is_share_creator=true")
	}

	// 2) no filter → 2 events, newest first, visit A has asset_view_count=2, trip_title=云南.
	r = te.do("GET", "/api/admin/audit/events", tok, nil, "")
	var allResp auditEventsResp
	mustDecode(t, r, &allResp)
	r.Body.Close()
	if len(allResp.Events) != 2 {
		t.Fatalf("no filter: want 2 events, got %d", len(allResp.Events))
	}
	if allResp.Events[0].VisitID != visitB.ID {
		t.Fatalf("no filter: want B first, got %d", allResp.Events[0].VisitID)
	}
	if allResp.Events[1].VisitID != visitA.ID {
		t.Fatalf("no filter: want A second, got %d", allResp.Events[1].VisitID)
	}
	if allResp.Events[1].AssetViewCount != 2 {
		t.Fatalf("no filter: want A.asset_view_count=2, got %d", allResp.Events[1].AssetViewCount)
	}
	if allResp.Events[1].TripTitle != "云南" {
		t.Fatalf("no filter: want trip_title=云南, got %q", allResp.Events[1].TripTitle)
	}
	if allResp.Events[1].ShareCode != "abc123" {
		t.Fatalf("no filter: want share_code=abc123, got %q", allResp.Events[1].ShareCode)
	}

	// 3) trip_id filter → 2 events.
	r = te.do("GET", fmt.Sprintf("/api/admin/audit/events?trip_id=%d", trip.ID), tok, nil, "")
	var tripResp auditEventsResp
	mustDecode(t, r, &tripResp)
	r.Body.Close()
	if len(tripResp.Events) != 2 {
		t.Fatalf("trip filter: want 2 events, got %d", len(tripResp.Events))
	}

	// 4) share_id filter → 2 events.
	r = te.do("GET", fmt.Sprintf("/api/admin/audit/events?share_id=%d", share.ID), tok, nil, "")
	var shareResp auditEventsResp
	mustDecode(t, r, &shareResp)
	r.Body.Close()
	if len(shareResp.Events) != 2 {
		t.Fatalf("share filter: want 2 events, got %d", len(shareResp.Events))
	}
}

func TestAuditEventsDeletedTrip(t *testing.T) {
	te := newTestEnv(t)
	adminID := te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	trip, err := te.client.Trip.Create().
		SetSlug("deleted-trip").
		SetTitle("real").
		SetCreatedByID(adminID).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	share, err := te.client.ShareLink.Create().
		SetScope(sharelink.ScopeTrip).
		SetTripID(trip.ID).
		SetCode("delshare").
		SetPasswordHash("x").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = te.client.Visit.Create().
		SetShareID(share.ID).
		SetSessionID("sess-d").
		SetIP("3.3.3.3").
		SetVisitedAt(time.Now().UTC()).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	// Try to point the share at a nonexistent trip. FK enforcement may block this.
	if _, err := te.client.ShareLink.UpdateOneID(share.ID).SetTripID(999999).Save(ctx); err != nil {
		t.Skipf("FK blocks deleted-trip simulation: %v", err)
	}

	r := te.do("GET", "/api/admin/audit/events", tok, nil, "")
	var resp auditEventsResp
	mustDecode(t, r, &resp)
	r.Body.Close()
	if len(resp.Events) != 1 {
		t.Fatalf("want 1 event, got %d", len(resp.Events))
	}
	if resp.Events[0].TripTitle != "(已删除)" {
		t.Fatalf("want trip_title=(已删除), got %q", resp.Events[0].TripTitle)
	}
}
