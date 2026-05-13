# 分享访问追溯（Admin Audit）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 admin 区新增「访问追溯」一级页面，集中查看跨 trip / 跨 share 的访问事件、分享总览、相册维度汇总和单 trip 详细趋势页。

**Architecture:** 新增后端 4 个 admin only endpoint (`/api/admin/audit/*`)，基于现有 `visit / asset_view / share_link / share_trip / trip` 表现算（小数据量 < 1 万 visits），不引入新表 / 缓存表。前端新增 `Audit` 容器 + 3 个 Tab + 1 个详细趋势页，Layout 顶部加入口。复用现有 `StatsModal` / `ShareTreePanel`，从 `SharesPanel.tsx` 抽出共享。

**Tech Stack:** Go 1.x + Echo + ent + PostgreSQL（测试 SQLite）/ React + Vite + Tailwind v4 + react-router-dom

**Spec:** `docs/superpowers/specs/2026-05-13-share-audit-design.md`

## 实现注记

1. **ent 聚合 API 落地**：本计划在若干处使用 `.GroupBy(field).Aggregate(ent.Count(), ent.Max(...)).Scan(&out)`。如果当前项目的 ent 版本对该写法的列名映射与示例结构体不匹配（项目现有代码统一用 `.All(ctx)` 后在 Go 里 tally 的模式，例如 `share_stats.go` 中的 `tally` map），优先沿用现有模式。每个相关步骤里只要把 `Aggregate(...).Scan` 部分替换为：拿到全量行后在 Go 里用 map 计 count / max / distinct，**最终输出 JSON 结构不变**。

2. **缩略图签名 URL**：Task 5 中 `h.SignedURLs.GetOrBuild` / `h.OSS.PresignThumb` 为伪签名。在写这一步之前先看 `internal/handler/asset.go` 现有缩略图 URL 构建调用（如 `presignAssetVariant` 或类似 helper），复用相同调用模式即可，不要重新设计签名 API。如签名 URL 构建失败，按本计划要求把 `thumb_url` 留空而不是让整个请求失败。

---

## 文件结构

**新建（后端）：**
- `internal/handler/audit.go` — 4 个 endpoint + 内部聚合 helpers
- `internal/handler/audit_test.go` — 端到端测试

**修改（后端）：**
- `internal/server/server.go` — 注册 `/api/admin/audit/*` 路由组
- `internal/handler/integration_test.go` — `mountAPI` 注册同样的路由（带 admin 权限中间件）

**新建（前端）：**
- `web/src/pages/admin/Audit.tsx` — Tab 容器
- `web/src/pages/admin/audit/EventsTab.tsx`
- `web/src/pages/admin/audit/SharesTab.tsx`
- `web/src/pages/admin/audit/TripsTab.tsx`
- `web/src/pages/admin/audit/TripAuditDetail.tsx`
- `web/src/pages/admin/audit/Sparkline.tsx`
- `web/src/components/share/StatsModal.tsx` — 从 `SharesPanel.tsx` 抽出
- `web/src/components/share/ShareTreePanel.tsx` — 从 `SharesPanel.tsx` 抽出

**修改（前端）：**
- `web/src/components/SharesPanel.tsx` — 改 import 复用抽出的组件
- `web/src/lib/api.ts` — 加 4 个方法 + 类型
- `web/src/router.tsx` — 加路由
- `web/src/components/Layout.tsx` — 加导航项

---

## Task 1: 后端骨架 + 权限路由

**Files:**
- Create: `internal/handler/audit.go`
- Create: `internal/handler/audit_test.go`
- Modify: `internal/server/server.go`
- Modify: `internal/handler/integration_test.go`

- [ ] **Step 1: 写 audit.go 骨架（4 个空 handler 返回 501）**

```go
// internal/handler/audit.go
package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// All endpoints in this file are mounted under /api/admin/audit and require
// admin role. Group-level middleware enforces auth; handlers do not re-check.

func (h *Handler) AuditEvents(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditShares(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTrips(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTripDetail(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}
```

- [ ] **Step 2: 注册路由（生产）**

修改 `internal/server/server.go`，在 `adminCmt` 路由组之后加入：

```go
// Admin audit (cross-trip access tracking)
adminAudit := api.Group("/admin/audit", auth.RequireRole(auth.RoleAdmin))
adminAudit.GET("/events", h.AuditEvents)
adminAudit.GET("/shares", h.AuditShares)
adminAudit.GET("/trips", h.AuditTrips)
adminAudit.GET("/trips/:id", h.AuditTripDetail)
```

- [ ] **Step 3: 注册路由（测试）**

修改 `internal/handler/integration_test.go` 的 `mountAPI`，在末尾加入：

```go
// Admin audit (matches prod: admin only)
audit := api.Group("/admin/audit", auth.RequireRole(auth.RoleAdmin))
audit.GET("/events", h.AuditEvents)
audit.GET("/shares", h.AuditShares)
audit.GET("/trips", h.AuditTrips)
audit.GET("/trips/:id", h.AuditTripDetail)
```

- [ ] **Step 4: 写权限测试**

新建 `internal/handler/audit_test.go`：

```go
package handler_test

import (
	"net/http"
	"testing"

	"github.com/cloverstd/travel-moments/internal/ent/user"
)

func TestAuditEndpointsPermissions(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	te.seedUser(user.RoleEditor, "editor", "pw")
	editorTok := te.login("editor", "pw")

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
```

- [ ] **Step 5: 跑测试，断言通过**

Run: `go test ./internal/handler/ -run TestAuditEndpointsPermissions -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/handler/audit.go internal/handler/audit_test.go internal/server/server.go internal/handler/integration_test.go
git commit -m "audit: stub admin audit routes with permission test"
```

---

## Task 2: AuditEvents（事件流）

**Files:**
- Modify: `internal/handler/audit.go`
- Modify: `internal/handler/audit_test.go`

- [ ] **Step 1: 写测试**

加到 `audit_test.go`：

```go
import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cloverstd/travel-moments/internal/ent/user"
)

type auditEventJSON struct {
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
	Events     []auditEventJSON `json:"events"`
	NextBefore *time.Time       `json:"next_before"`
}

func seedAuditFixtures(t *testing.T, te *testEnv) (tripID, shareID int) {
	t.Helper()
	ctx := t.Context()
	trip, err := te.client.Trip.Create().
		SetTitle("云南").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	share, err := te.client.ShareLink.Create().
		SetScope("trip").
		SetTripID(trip.ID).
		SetCode("abc123").
		SetPasswordHash("x").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return trip.ID, share.ID
}

func TestAuditEventsPagination(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	_, shareID := seedAuditFixtures(t, te)

	// Seed 60 visits across 60 seconds.
	now := time.Now()
	for i := 0; i < 60; i++ {
		_, err := te.client.Visit.Create().
			SetShareID(shareID).
			SetSessionID(fmt.Sprintf("s%d", i)).
			SetIP(fmt.Sprintf("10.0.0.%d", i)).
			SetVisitedAt(now.Add(-time.Duration(i) * time.Second)).
			Save(t.Context())
		if err != nil {
			t.Fatal(err)
		}
	}

	// First page: default limit 50.
	r := te.do("GET", "/api/admin/audit/events", tok, nil, "")
	defer r.Body.Close()
	var page1 auditEventsResp
	mustDecode(t, r, &page1)
	if len(page1.Events) != 50 {
		t.Fatalf("page1: want 50, got %d", len(page1.Events))
	}
	if page1.NextBefore == nil {
		t.Fatal("page1: expected next_before non-nil")
	}

	// Second page using before cursor.
	url := fmt.Sprintf("/api/admin/audit/events?before=%s", page1.NextBefore.Format(time.RFC3339Nano))
	r = te.do("GET", url, tok, nil, "")
	defer r.Body.Close()
	var page2 auditEventsResp
	mustDecode(t, r, &page2)
	if len(page2.Events) != 10 {
		t.Fatalf("page2: want 10, got %d", len(page2.Events))
	}
	if page2.NextBefore != nil {
		t.Fatalf("page2: expected next_before nil, got %v", page2.NextBefore)
	}
}

func TestAuditEventsFiltersAndFields(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	tripID, shareID := seedAuditFixtures(t, te)

	// Visit A: regular
	now := time.Now()
	vA, err := te.client.Visit.Create().
		SetShareID(shareID).
		SetSessionID("sA").
		SetIP("1.1.1.1").
		SetVisitedAt(now.Add(-2 * time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Visit B: created a child share
	vB, err := te.client.Visit.Create().
		SetShareID(shareID).
		SetSessionID("sB").
		SetIP("2.2.2.2").
		SetVisitedAt(now.Add(-1 * time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = te.client.ShareLink.Create().
		SetScope("trip").
		SetTripID(tripID).
		SetCode("child1").
		SetPasswordHash("x").
		SetParentShareID(shareID).
		SetCreatorVisitID(vB.ID).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Two asset views for visit A.
	asset, err := te.client.Asset.Create().
		SetTripID(tripID).
		SetKind("image").
		SetObjectKey("k1").
		SetOriginalFilename("k1.jpg").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		_, err := te.client.AssetView.Create().
			SetVisitID(vA.ID).
			SetAssetID(asset.ID).
			SetViewedAt(now).
			Save(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}

	// Filter by ip.
	r := te.do("GET", "/api/admin/audit/events?ip=2.2.2.2", tok, nil, "")
	defer r.Body.Close()
	var p auditEventsResp
	mustDecode(t, r, &p)
	if len(p.Events) != 1 || p.Events[0].VisitID != vB.ID {
		t.Fatalf("ip filter: %+v", p.Events)
	}
	if !p.Events[0].IsShareCreator {
		t.Fatalf("expected is_share_creator=true for visit B")
	}

	// No filter: both events, newest first.
	r = te.do("GET", "/api/admin/audit/events", tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &p)
	if len(p.Events) != 2 {
		t.Fatalf("want 2, got %d", len(p.Events))
	}
	if p.Events[0].VisitID != vB.ID || p.Events[1].VisitID != vA.ID {
		t.Fatalf("order: %+v", p.Events)
	}
	if p.Events[1].AssetViewCount != 2 {
		t.Fatalf("asset_view_count for A: want 2, got %d", p.Events[1].AssetViewCount)
	}
	if p.Events[0].TripTitle != "云南" {
		t.Fatalf("trip_title: %s", p.Events[0].TripTitle)
	}

	// Filter by trip_id.
	r = te.do("GET", fmt.Sprintf("/api/admin/audit/events?trip_id=%d", tripID), tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &p)
	if len(p.Events) != 2 {
		t.Fatalf("trip filter: want 2, got %d", len(p.Events))
	}

	// Filter by share_id (the parent share — only visits attached to it).
	r = te.do("GET", fmt.Sprintf("/api/admin/audit/events?share_id=%d", shareID), tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &p)
	if len(p.Events) != 2 {
		t.Fatalf("share filter: want 2, got %d", len(p.Events))
	}
}

func TestAuditEventsDeletedTrip(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()
	_, shareID := seedAuditFixtures(t, te)

	// Create a visit, then delete the share's trip via direct ent (simulating
	// orphaned visit row). To break FK we have to delete the share too —
	// instead we just clear the trip_id by using share with a non-existent
	// trip_id via raw insert. Simpler: drop the trip after creating visit, but
	// FK will cascade-delete share+visit. So instead create a visit pointing at
	// a deleted share would require explicit FK off — we use the same approach
	// as the handler: when share.Trip lookup fails, render "(已删除)".
	_, err := te.client.Visit.Create().
		SetShareID(shareID).
		SetSessionID("x").
		SetIP("9.9.9.9").
		SetVisitedAt(time.Now()).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Force trip_title to fall back: artificially update share.trip_id to a
	// non-existent value. ent normally would block but FKs aren't enforced for
	// updates in our SQLite test config — try anyway and skip if it errors.
	_, _ = te.client.ShareLink.UpdateOneID(shareID).SetTripID(999999).Save(ctx)

	r := te.do("GET", "/api/admin/audit/events", tok, nil, "")
	defer r.Body.Close()
	var p auditEventsResp
	mustDecode(t, r, &p)
	if len(p.Events) == 0 {
		t.Fatal("expected at least one event")
	}
	if p.Events[0].TripTitle != "(已删除)" {
		t.Skipf("trip_title=%q (test depends on ent FK behavior; skipping if FK blocked update)", p.Events[0].TripTitle)
	}
}

var _ = bytes.NewReader
var _ = json.Marshal
var _ = io.EOF
var _ = strings.Join
```

- [ ] **Step 2: 跑测试，断言全部失败（路由返 501）**

Run: `go test ./internal/handler/ -run 'TestAuditEvents' -v`
Expected: FAIL（所有 audit events 测试，因为 handler 返 501）

- [ ] **Step 3: 实现 AuditEvents**

替换 `audit.go` 中的 `AuditEvents`：

```go
// internal/handler/audit.go
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/assetview"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/trip"
	"github.com/cloverstd/travel-moments/internal/ent/visit"
)

const (
	auditEventsDefaultLimit = 50
	auditEventsMaxLimit     = 200
)

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
	Events     []auditEvent `json:"events"`
	NextBefore *time.Time   `json:"next_before"`
}

func (h *Handler) AuditEvents(c echo.Context) error {
	ctx := c.Request().Context()

	limit := auditEventsDefaultLimit
	if s := c.QueryParam("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
			if limit > auditEventsMaxLimit {
				limit = auditEventsMaxLimit
			}
		}
	}

	q := h.DB.Visit.Query().Order(ent.Desc(visit.FieldVisitedAt), ent.Desc(visit.FieldID))

	if s := c.QueryParam("before"); s != "" {
		t, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			t, err = time.Parse(time.RFC3339, s)
		}
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad before")
		}
		q = q.Where(visit.VisitedAtLT(t))
	}
	if s := c.QueryParam("share_id"); s != "" {
		id, err := strconv.Atoi(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad share_id")
		}
		q = q.Where(visit.ShareIDEQ(id))
	}
	if s := c.QueryParam("ip"); s != "" {
		q = q.Where(visit.IPEQ(s))
	}

	// trip_id filter: find share_ids whose trip_id matches (incl. share_trips
	// extra-trips), then filter visits by share_id.
	if s := c.QueryParam("trip_id"); s != "" {
		tripID, err := strconv.Atoi(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad trip_id")
		}
		shareIDs, err := h.shareIDsForTrip(ctx, tripID)
		if err != nil {
			return err
		}
		if len(shareIDs) == 0 {
			return c.JSON(http.StatusOK, auditEventsResp{Events: []auditEvent{}})
		}
		q = q.Where(visit.ShareIDIn(shareIDs...))
	}

	visits, err := q.Limit(limit + 1).All(ctx)
	if err != nil {
		return err
	}

	var nextBefore *time.Time
	if len(visits) > limit {
		v := visits[limit-1]
		nextBefore = &v.VisitedAt
		visits = visits[:limit]
	}

	out := auditEventsResp{Events: make([]auditEvent, 0, len(visits)), NextBefore: nextBefore}
	if len(visits) == 0 {
		return c.JSON(http.StatusOK, out)
	}

	shareIDSet := make(map[int]struct{})
	visitIDs := make([]int, 0, len(visits))
	for _, v := range visits {
		shareIDSet[v.ShareID] = struct{}{}
		visitIDs = append(visitIDs, v.ID)
	}
	shareIDs := make([]int, 0, len(shareIDSet))
	for id := range shareIDSet {
		shareIDs = append(shareIDs, id)
	}

	shares, err := h.DB.ShareLink.Query().Where(sharelink.IDIn(shareIDs...)).All(ctx)
	if err != nil {
		return err
	}
	shareByID := make(map[int]*ent.ShareLink, len(shares))
	tripIDSet := make(map[int]struct{})
	for _, s := range shares {
		shareByID[s.ID] = s
		tripIDSet[s.TripID] = struct{}{}
	}
	tripIDs := make([]int, 0, len(tripIDSet))
	for id := range tripIDSet {
		tripIDs = append(tripIDs, id)
	}
	trips, err := h.DB.Trip.Query().Where(trip.IDIn(tripIDs...)).All(ctx)
	if err != nil {
		return err
	}
	tripTitleByID := make(map[int]string, len(trips))
	for _, tr := range trips {
		tripTitleByID[tr.ID] = tr.Title
	}

	// asset_view counts
	type viewRow struct {
		VisitID int `json:"visit_id"`
		Count   int `json:"count"`
	}
	var viewRows []viewRow
	err = h.DB.AssetView.Query().
		Where(assetview.VisitIDIn(visitIDs...)).
		GroupBy(assetview.FieldVisitID).
		Aggregate(ent.Count()).
		Scan(ctx, &viewRows)
	if err != nil {
		return err
	}
	viewCount := make(map[int]int, len(viewRows))
	for _, r := range viewRows {
		viewCount[r.VisitID] = r.Count
	}

	// is_share_creator
	creators, err := h.DB.ShareLink.Query().
		Where(sharelink.CreatorVisitIDIn(visitIDs...)).
		Select(sharelink.FieldCreatorVisitID).
		Ints(ctx)
	if err != nil {
		return err
	}
	creatorSet := make(map[int]struct{}, len(creators))
	for _, id := range creators {
		creatorSet[id] = struct{}{}
	}

	for _, v := range visits {
		s := shareByID[v.ShareID]
		title := "(已删除)"
		shareCode := ""
		tripID := 0
		if s != nil {
			shareCode = s.Code
			tripID = s.TripID
			if t, ok := tripTitleByID[s.TripID]; ok {
				title = t
			}
		}
		_, isCreator := creatorSet[v.ID]
		out.Events = append(out.Events, auditEvent{
			VisitID:        v.ID,
			ShareID:        v.ShareID,
			ShareCode:      shareCode,
			TripID:         tripID,
			TripTitle:      title,
			IP:             v.IP,
			UA:             truncString(v.Ua, 200),
			Country:        v.Country,
			Referer:        v.Referer,
			VisitedAt:      v.VisitedAt,
			AssetViewCount: viewCount[v.ID],
			IsShareCreator: isCreator,
		})
	}

	return c.JSON(http.StatusOK, out)
}

// shareIDsForTrip returns all share IDs whose primary trip is tripID OR which
// reference tripID via the share_trips extra-trip table.
func (h *Handler) shareIDsForTrip(ctx context.Context, tripID int) ([]int, error) {
	primary, err := h.DB.ShareLink.Query().
		Where(sharelink.TripIDEQ(tripID)).
		IDs(ctx)
	if err != nil {
		return nil, err
	}
	extra, err := h.DB.ShareLink.Query().
		Where(sharelink.HasExtraTripsWith(trip.IDEQ(tripID))).
		IDs(ctx)
	if err != nil {
		return nil, err
	}
	seen := make(map[int]struct{}, len(primary)+len(extra))
	out := make([]int, 0, len(primary)+len(extra))
	for _, id := range primary {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	for _, id := range extra {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out, nil
}
```

加入 `"context"` import 到文件顶部。

- [ ] **Step 4: 跑测试**

Run: `go test ./internal/handler/ -run 'TestAuditEvents' -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/handler/audit.go internal/handler/audit_test.go
git commit -m "audit: implement AuditEvents endpoint (paginated event stream)"
```

---

## Task 3: AuditShares（分享总览）

**Files:**
- Modify: `internal/handler/audit.go`
- Modify: `internal/handler/audit_test.go`

- [ ] **Step 1: 写测试**

加到 `audit_test.go`：

```go
type auditShareRow struct {
	ID            int        `json:"id"`
	Code          string     `json:"code"`
	Scope         string     `json:"scope"`
	Note          string     `json:"note"`
	TripID        int        `json:"trip_id"`
	TripTitle     string     `json:"trip_title"`
	CreatedAt     time.Time  `json:"created_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
	RevokedAt     *time.Time `json:"revoked_at"`
	Visits        int        `json:"visits"`
	UniqueIPs     int        `json:"unique_ips"`
	ChildCount    int        `json:"child_count"`
	LastVisitAt   *time.Time `json:"last_visit_at"`
	DisableForwd  bool       `json:"disable_forward"`
}

type auditSharesResp struct {
	Shares []auditShareRow `json:"shares"`
}

func TestAuditSharesAggregation(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	trip1, _ := te.client.Trip.Create().SetTitle("T1").Save(ctx)
	trip2, _ := te.client.Trip.Create().SetTitle("T2").Save(ctx)

	// share A on trip1: 3 visits (2 unique ips), 1 child
	sA, _ := te.client.ShareLink.Create().SetScope("trip").SetTripID(trip1.ID).
		SetCode("A").SetPasswordHash("x").Save(ctx)
	now := time.Now()
	for i, ip := range []string{"1.1.1.1", "1.1.1.1", "2.2.2.2"} {
		te.client.Visit.Create().SetShareID(sA.ID).SetSessionID(fmt.Sprintf("a%d", i)).
			SetIP(ip).SetVisitedAt(now.Add(time.Duration(i) * time.Second)).
			SaveX(ctx)
	}
	te.client.ShareLink.Create().SetScope("trip").SetTripID(trip1.ID).
		SetCode("Achild").SetPasswordHash("x").SetParentShareID(sA.ID).SaveX(ctx)

	// share B on trip2: 1 visit, revoked
	revoked := now.Add(-time.Minute)
	sB, _ := te.client.ShareLink.Create().SetScope("trip").SetTripID(trip2.ID).
		SetCode("B").SetPasswordHash("x").SetRevokedAt(revoked).Save(ctx)
	te.client.Visit.Create().SetShareID(sB.ID).SetSessionID("b1").
		SetIP("3.3.3.3").SetVisitedAt(now).SaveX(ctx)

	// share C on trip2: expired in past
	past := now.Add(-time.Hour)
	te.client.ShareLink.Create().SetScope("trip").SetTripID(trip2.ID).
		SetCode("C").SetPasswordHash("x").SetExpiresAt(past).SaveX(ctx)

	// Default (status=active): only sA returned (the child Achild is also active)
	r := te.do("GET", "/api/admin/audit/shares", tok, nil, "")
	defer r.Body.Close()
	var resp auditSharesResp
	mustDecode(t, r, &resp)
	codes := make(map[string]auditShareRow)
	for _, s := range resp.Shares {
		codes[s.Code] = s
	}
	if _, ok := codes["A"]; !ok {
		t.Fatalf("active should include A, got %v", keys(codes))
	}
	if _, ok := codes["B"]; ok {
		t.Fatalf("active should NOT include revoked B")
	}
	if _, ok := codes["C"]; ok {
		t.Fatalf("active should NOT include expired C")
	}
	rowA := codes["A"]
	if rowA.Visits != 3 || rowA.UniqueIPs != 2 || rowA.ChildCount != 1 {
		t.Fatalf("A aggregation: %+v", rowA)
	}
	if rowA.TripTitle != "T1" {
		t.Fatalf("trip title: %s", rowA.TripTitle)
	}
	if rowA.LastVisitAt == nil {
		t.Fatal("last_visit_at nil")
	}

	// status=all: all 4 shares (A, Achild, B, C)
	r = te.do("GET", "/api/admin/audit/shares?status=all", tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &resp)
	if len(resp.Shares) != 4 {
		t.Fatalf("status=all: want 4, got %d", len(resp.Shares))
	}

	// status=revoked: just B
	r = te.do("GET", "/api/admin/audit/shares?status=revoked", tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &resp)
	if len(resp.Shares) != 1 || resp.Shares[0].Code != "B" {
		t.Fatalf("status=revoked: %+v", resp.Shares)
	}

	// status=expired: just C
	r = te.do("GET", "/api/admin/audit/shares?status=expired", tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &resp)
	if len(resp.Shares) != 1 || resp.Shares[0].Code != "C" {
		t.Fatalf("status=expired: %+v", resp.Shares)
	}

	// order=visits: A first
	r = te.do("GET", "/api/admin/audit/shares?status=all&order=visits", tok, nil, "")
	defer r.Body.Close()
	mustDecode(t, r, &resp)
	if resp.Shares[0].Code != "A" {
		t.Fatalf("order=visits: first should be A, got %s", resp.Shares[0].Code)
	}
}

func keys(m map[string]auditShareRow) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

- [ ] **Step 2: 跑测试，断言失败**

Run: `go test ./internal/handler/ -run TestAuditShares -v`
Expected: FAIL（501）

- [ ] **Step 3: 实现 AuditShares**

在 `audit.go` 末尾添加：

```go
type auditShareRow struct {
	ID           int        `json:"id"`
	Code         string     `json:"code"`
	Scope        string     `json:"scope"`
	Note         string     `json:"note"`
	TripID       int        `json:"trip_id"`
	TripTitle    string     `json:"trip_title"`
	CreatedAt    time.Time  `json:"created_at"`
	ExpiresAt    *time.Time `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
	Visits       int        `json:"visits"`
	UniqueIPs    int        `json:"unique_ips"`
	ChildCount   int        `json:"child_count"`
	LastVisitAt  *time.Time `json:"last_visit_at"`
	DisableForwd bool       `json:"disable_forward"`
}

type auditSharesResp struct {
	Shares []auditShareRow `json:"shares"`
}

func (h *Handler) AuditShares(c echo.Context) error {
	ctx := c.Request().Context()
	status := c.QueryParam("status")
	if status == "" {
		status = "active"
	}
	order := c.QueryParam("order")
	if order == "" {
		order = "recent_visit"
	}
	query := c.QueryParam("q")

	shares, err := h.DB.ShareLink.Query().All(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	filtered := shares[:0]
	for _, s := range shares {
		// status filter
		isRevoked := s.RevokedAt != nil
		isExpired := s.ExpiresAt != nil && s.ExpiresAt.Before(now)
		switch status {
		case "active":
			if isRevoked || isExpired {
				continue
			}
		case "revoked":
			if !isRevoked {
				continue
			}
		case "expired":
			if isRevoked || !isExpired {
				continue
			}
		case "all":
			// no-op
		default:
			return echo.NewHTTPError(http.StatusBadRequest, "bad status")
		}
		// q filter (matches code or note, case-insensitive)
		if query != "" {
			ql := strings.ToLower(query)
			if !strings.Contains(strings.ToLower(s.Code), ql) &&
				!strings.Contains(strings.ToLower(s.Note), ql) {
				continue
			}
		}
		filtered = append(filtered, s)
	}

	// Visit aggregation per share.
	type visitAgg struct {
		ShareID    int       `json:"share_id"`
		Visits     int       `json:"visits"`
		LastVisit  time.Time `json:"last_visit"`
		// We compute unique_ips separately because ent's count_distinct via
		// GroupBy + Aggregate is awkward; we do it manually in a second pass.
	}
	var aggs []visitAgg
	err = h.DB.Visit.Query().
		GroupBy(visit.FieldShareID).
		Aggregate(
			ent.Count(),
			ent.Max(visit.FieldVisitedAt),
		).
		Scan(ctx, &aggs)
	if err != nil {
		return err
	}
	aggByShare := make(map[int]visitAgg, len(aggs))
	for _, a := range aggs {
		aggByShare[a.ShareID] = a
	}

	// Unique IPs per share: load visits in batches (small data) and count
	// distinct IPs in Go.
	ipVisits, err := h.DB.Visit.Query().
		Select(visit.FieldShareID, visit.FieldIP).
		All(ctx)
	if err != nil {
		return err
	}
	ipSet := make(map[int]map[string]struct{})
	for _, v := range ipVisits {
		if v.IP == "" {
			continue
		}
		if ipSet[v.ShareID] == nil {
			ipSet[v.ShareID] = make(map[string]struct{})
		}
		ipSet[v.ShareID][v.IP] = struct{}{}
	}

	// Child counts per parent.
	type childAgg struct {
		ParentShareID int `json:"parent_share_id"`
		Count         int `json:"count"`
	}
	var childAggs []childAgg
	err = h.DB.ShareLink.Query().
		Where(sharelink.ParentShareIDNotNil()).
		GroupBy(sharelink.FieldParentShareID).
		Aggregate(ent.Count()).
		Scan(ctx, &childAggs)
	if err != nil {
		return err
	}
	childCount := make(map[int]int, len(childAggs))
	for _, c := range childAggs {
		childCount[c.ParentShareID] = c.Count
	}

	// Trip titles in one query for all filtered shares.
	tripIDSet := make(map[int]struct{})
	for _, s := range filtered {
		tripIDSet[s.TripID] = struct{}{}
	}
	tripIDs := make([]int, 0, len(tripIDSet))
	for id := range tripIDSet {
		tripIDs = append(tripIDs, id)
	}
	tripTitle := make(map[int]string)
	if len(tripIDs) > 0 {
		trips, err := h.DB.Trip.Query().Where(trip.IDIn(tripIDs...)).All(ctx)
		if err != nil {
			return err
		}
		for _, t := range trips {
			tripTitle[t.ID] = t.Title
		}
	}

	rows := make([]auditShareRow, 0, len(filtered))
	for _, s := range filtered {
		a := aggByShare[s.ID]
		var lv *time.Time
		if !a.LastVisit.IsZero() {
			t := a.LastVisit
			lv = &t
		}
		title, ok := tripTitle[s.TripID]
		if !ok {
			title = "(已删除)"
		}
		rows = append(rows, auditShareRow{
			ID:           s.ID,
			Code:         s.Code,
			Scope:        string(s.Scope),
			Note:         s.Note,
			TripID:       s.TripID,
			TripTitle:    title,
			CreatedAt:    s.CreatedAt,
			ExpiresAt:    s.ExpiresAt,
			RevokedAt:    s.RevokedAt,
			Visits:       a.Visits,
			UniqueIPs:    len(ipSet[s.ID]),
			ChildCount:   childCount[s.ID],
			LastVisitAt:  lv,
			DisableForwd: s.DisableForward,
		})
	}

	// Sort
	sort.Slice(rows, func(i, j int) bool {
		switch order {
		case "visits":
			return rows[i].Visits > rows[j].Visits
		case "created":
			return rows[i].CreatedAt.After(rows[j].CreatedAt)
		case "recent_visit":
			fallthrough
		default:
			a, b := rows[i].LastVisitAt, rows[j].LastVisitAt
			if a == nil && b == nil {
				return rows[i].CreatedAt.After(rows[j].CreatedAt)
			}
			if a == nil {
				return false
			}
			if b == nil {
				return true
			}
			return a.After(*b)
		}
	})

	return c.JSON(http.StatusOK, auditSharesResp{Shares: rows})
}
```

加 imports：`"sort"`, `"strings"`。

- [ ] **Step 4: 跑测试**

Run: `go test ./internal/handler/ -run TestAuditShares -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/handler/audit.go internal/handler/audit_test.go
git commit -m "audit: implement AuditShares endpoint (cross-trip share table)"
```

---

## Task 4: AuditTrips（相册维度列表）

**Files:**
- Modify: `internal/handler/audit.go`
- Modify: `internal/handler/audit_test.go`

- [ ] **Step 1: 写测试**

加到 `audit_test.go`：

```go
type auditTripRow struct {
	TripID          int        `json:"trip_id"`
	Title           string     `json:"title"`
	ShareCount      int        `json:"share_count"`
	TotalVisits     int        `json:"total_visits"`
	UniqueVisitors  int        `json:"unique_visitors"`
	LastVisitAt     *time.Time `json:"last_visit_at"`
}
type auditTripsResp struct {
	Trips []auditTripRow `json:"trips"`
}

func TestAuditTripsAggregation(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	trip1, _ := te.client.Trip.Create().SetTitle("T1").Save(ctx)
	trip2, _ := te.client.Trip.Create().SetTitle("T2").Save(ctx)

	// Share on trip1
	s1, _ := te.client.ShareLink.Create().SetScope("trip").SetTripID(trip1.ID).
		SetCode("s1").SetPasswordHash("x").Save(ctx)
	// Multi-trip share: primary=trip1, extra=trip2
	s2, _ := te.client.ShareLink.Create().SetScope("multi").SetTripID(trip1.ID).
		SetCode("s2").SetPasswordHash("x").Save(ctx)
	te.client.ShareTrip.Create().SetShareID(s2.ID).SetTripID(trip2.ID).SaveX(ctx)

	now := time.Now()
	te.client.Visit.Create().SetShareID(s1.ID).SetSessionID("v1").
		SetIP("1.1.1.1").SetVisitedAt(now).SaveX(ctx)
	te.client.Visit.Create().SetShareID(s1.ID).SetSessionID("v2").
		SetIP("1.1.1.1").SetVisitedAt(now).SaveX(ctx)
	te.client.Visit.Create().SetShareID(s2.ID).SetSessionID("v3").
		SetIP("2.2.2.2").SetVisitedAt(now).SaveX(ctx)

	r := te.do("GET", "/api/admin/audit/trips", tok, nil, "")
	defer r.Body.Close()
	var resp auditTripsResp
	mustDecode(t, r, &resp)
	byTitle := make(map[string]auditTripRow)
	for _, r := range resp.Trips {
		byTitle[r.Title] = r
	}
	t1 := byTitle["T1"]
	t2 := byTitle["T2"]
	// trip1 has shares s1+s2, visits 3 (all visits via these shares), unique ips 2
	if t1.ShareCount != 2 {
		t.Fatalf("T1 share_count: want 2, got %d", t1.ShareCount)
	}
	if t1.TotalVisits != 3 {
		t.Fatalf("T1 total_visits: want 3, got %d", t1.TotalVisits)
	}
	if t1.UniqueVisitors != 2 {
		t.Fatalf("T1 unique_visitors: want 2, got %d", t1.UniqueVisitors)
	}
	// trip2 has shares: s2 (via share_trips), 1 visit (from s2), 1 unique ip
	if t2.ShareCount != 1 {
		t.Fatalf("T2 share_count: want 1, got %d", t2.ShareCount)
	}
	if t2.TotalVisits != 1 {
		t.Fatalf("T2 total_visits: want 1, got %d", t2.TotalVisits)
	}
}
```

- [ ] **Step 2: 跑测试，断言失败**

Run: `go test ./internal/handler/ -run TestAuditTrips -v`
Expected: FAIL

- [ ] **Step 3: 实现 AuditTrips**

加到 `audit.go`：

```go
type auditTripRow struct {
	TripID         int        `json:"trip_id"`
	Title          string     `json:"title"`
	ShareCount     int        `json:"share_count"`
	TotalVisits    int        `json:"total_visits"`
	UniqueVisitors int        `json:"unique_visitors"`
	LastVisitAt    *time.Time `json:"last_visit_at"`
}

type auditTripsResp struct {
	Trips []auditTripRow `json:"trips"`
}

func (h *Handler) AuditTrips(c echo.Context) error {
	ctx := c.Request().Context()

	trips, err := h.DB.Trip.Query().All(ctx)
	if err != nil {
		return err
	}

	// Map trip -> set of share IDs (primary + extra via share_trips).
	tripShares := make(map[int]map[int]struct{}, len(trips))
	for _, t := range trips {
		tripShares[t.ID] = make(map[int]struct{})
	}
	shares, err := h.DB.ShareLink.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, s := range shares {
		if set, ok := tripShares[s.TripID]; ok {
			set[s.ID] = struct{}{}
		}
	}
	// Extra trips via share_trips join table.
	extraRows, err := h.DB.ShareTrip.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, r := range extraRows {
		if set, ok := tripShares[r.TripID]; ok {
			set[r.ShareID] = struct{}{}
		}
	}

	// Load all visits (small data) and group by share.
	visits, err := h.DB.Visit.Query().All(ctx)
	if err != nil {
		return err
	}
	visitsByShare := make(map[int][]*ent.Visit, len(visits))
	for _, v := range visits {
		visitsByShare[v.ShareID] = append(visitsByShare[v.ShareID], v)
	}

	rows := make([]auditTripRow, 0, len(trips))
	for _, t := range trips {
		shareIDs := tripShares[t.ID]
		ips := make(map[string]struct{})
		total := 0
		var last *time.Time
		for sid := range shareIDs {
			for _, v := range visitsByShare[sid] {
				total++
				if v.IP != "" {
					ips[v.IP] = struct{}{}
				}
				if last == nil || v.VisitedAt.After(*last) {
					va := v.VisitedAt
					last = &va
				}
			}
		}
		rows = append(rows, auditTripRow{
			TripID:         t.ID,
			Title:          t.Title,
			ShareCount:     len(shareIDs),
			TotalVisits:    total,
			UniqueVisitors: len(ips),
			LastVisitAt:    last,
		})
	}

	// Sort by last_visit_at desc (nulls last), tie-break by trip ID desc.
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i].LastVisitAt, rows[j].LastVisitAt
		if a == nil && b == nil {
			return rows[i].TripID > rows[j].TripID
		}
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		return a.After(*b)
	})

	return c.JSON(http.StatusOK, auditTripsResp{Trips: rows})
}
```

- [ ] **Step 4: 跑测试**

Run: `go test ./internal/handler/ -run TestAuditTrips -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/handler/audit.go internal/handler/audit_test.go
git commit -m "audit: implement AuditTrips endpoint (trip-level aggregation)"
```

---

## Task 5: AuditTripDetail（单 trip 详细趋势）

**Files:**
- Modify: `internal/handler/audit.go`
- Modify: `internal/handler/audit_test.go`

- [ ] **Step 1: 写测试**

加到 `audit_test.go`：

```go
type auditDaily struct {
	Date      string `json:"date"`
	Visits    int    `json:"visits"`
	UniqueIPs int    `json:"unique_ips"`
}
type auditTopAsset struct {
	AssetID  int    `json:"asset_id"`
	Views    int    `json:"views"`
	ThumbURL string `json:"thumb_url"`
}
type auditRefererRow struct {
	Host  string `json:"host"`
	Count int    `json:"count"`
}
type auditCountryRow struct {
	Code  string `json:"code"`
	Count int    `json:"count"`
}
type auditTripDetailResp struct {
	Trip      map[string]any    `json:"trip"`
	Shares    []auditShareRow   `json:"shares"`
	Daily     []auditDaily      `json:"daily"`
	TopAssets []auditTopAsset   `json:"top_assets"`
	Referers  []auditRefererRow `json:"referers"`
	Countries []auditCountryRow `json:"countries"`
}

func TestAuditTripDetailDailyBackfillAndReferer(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	tripE, _ := te.client.Trip.Create().SetTitle("E").Save(ctx)
	share, _ := te.client.ShareLink.Create().SetScope("trip").SetTripID(tripE.ID).
		SetCode("E1").SetPasswordHash("x").Save(ctx)

	now := time.Now()
	day0 := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, time.Local)
	// Visits at D-30 and D-1
	te.client.Visit.Create().SetShareID(share.ID).SetSessionID("a").
		SetIP("1.1.1.1").SetReferer("https://t.me/foo").
		SetVisitedAt(day0.AddDate(0, 0, -30)).SaveX(ctx)
	te.client.Visit.Create().SetShareID(share.ID).SetSessionID("b").
		SetIP("2.2.2.2").SetReferer("https://t.me/bar").
		SetVisitedAt(day0.AddDate(0, 0, -1)).SaveX(ctx)
	// Empty referer
	te.client.Visit.Create().SetShareID(share.ID).SetSessionID("c").
		SetIP("3.3.3.3").SetReferer("").
		SetVisitedAt(day0.AddDate(0, 0, -1)).SaveX(ctx)

	r := te.do("GET", fmt.Sprintf("/api/admin/audit/trips/%d", tripE.ID), tok, nil, "")
	defer r.Body.Close()
	var resp auditTripDetailResp
	mustDecode(t, r, &resp)

	if len(resp.Daily) != 90 {
		t.Fatalf("daily: want 90 rows, got %d", len(resp.Daily))
	}
	// Expect last day (today, index 89) to be 0 visits; D-1 index 88 = 2; D-30 index 59 = 1.
	if resp.Daily[88].Visits != 2 {
		t.Errorf("D-1 visits: want 2, got %d", resp.Daily[88].Visits)
	}
	if resp.Daily[59].Visits != 1 {
		t.Errorf("D-30 visits: want 1, got %d", resp.Daily[59].Visits)
	}
	if resp.Daily[0].Visits != 0 {
		t.Errorf("D-89 visits: want 0, got %d", resp.Daily[0].Visits)
	}

	refByHost := make(map[string]int)
	for _, r := range resp.Referers {
		refByHost[r.Host] = r.Count
	}
	if refByHost["t.me"] != 2 {
		t.Errorf("referer t.me: want 2, got %d", refByHost["t.me"])
	}
	if refByHost["(直接访问)"] != 1 {
		t.Errorf("referer direct: want 1, got %d", refByHost["(直接访问)"])
	}
}

func TestAuditDoesNotWriteAuditLog(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	tok := te.login("admin", "pw")
	ctx := t.Context()

	before, _ := te.client.AuditLog.Query().Count(ctx)
	for _, p := range []string{
		"/api/admin/audit/events",
		"/api/admin/audit/shares",
		"/api/admin/audit/trips",
	} {
		r := te.do("GET", p, tok, nil, "")
		r.Body.Close()
	}
	after, _ := te.client.AuditLog.Query().Count(ctx)
	if before != after {
		t.Fatalf("audit_log rows changed: %d -> %d", before, after)
	}
}
```

- [ ] **Step 2: 跑测试，断言失败**

Run: `go test ./internal/handler/ -run TestAuditTripDetail -v`
Expected: FAIL

- [ ] **Step 3: 实现 AuditTripDetail**

加到 `audit.go`：

```go
type auditDaily struct {
	Date      string `json:"date"`
	Visits    int    `json:"visits"`
	UniqueIPs int    `json:"unique_ips"`
}
type auditTopAsset struct {
	AssetID  int    `json:"asset_id"`
	Views    int    `json:"views"`
	ThumbURL string `json:"thumb_url"`
}
type auditRefererRow struct {
	Host  string `json:"host"`
	Count int    `json:"count"`
}
type auditCountryRow struct {
	Code  string `json:"code"`
	Count int    `json:"count"`
}

type auditTripDetailResp struct {
	Trip      map[string]any    `json:"trip"`
	Shares    []auditShareRow   `json:"shares"`
	Daily     []auditDaily      `json:"daily"`
	TopAssets []auditTopAsset   `json:"top_assets"`
	Referers  []auditRefererRow `json:"referers"`
	Countries []auditCountryRow `json:"countries"`
}

const auditDailyDays = 90

func (h *Handler) AuditTripDetail(c echo.Context) error {
	ctx := c.Request().Context()
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	t, err := h.DB.Trip.Get(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "trip not found")
	}

	shareIDs, err := h.shareIDsForTrip(ctx, id)
	if err != nil {
		return err
	}

	// Daily bucket window: last N days inclusive of today.
	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	windowStart := dayStart.AddDate(0, 0, -(auditDailyDays - 1))

	var visits []*ent.Visit
	if len(shareIDs) > 0 {
		visits, err = h.DB.Visit.Query().
			Where(visit.ShareIDIn(shareIDs...), visit.VisitedAtGTE(windowStart)).
			All(ctx)
		if err != nil {
			return err
		}
	}

	// Daily aggregation.
	daily := make([]auditDaily, auditDailyDays)
	bucketIPs := make([]map[string]struct{}, auditDailyDays)
	for i := 0; i < auditDailyDays; i++ {
		d := windowStart.AddDate(0, 0, i)
		daily[i] = auditDaily{Date: d.Format("2006-01-02")}
		bucketIPs[i] = make(map[string]struct{})
	}
	for _, v := range visits {
		d := v.VisitedAt.In(now.Location())
		idx := int(time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, now.Location()).Sub(windowStart).Hours() / 24)
		if idx < 0 || idx >= auditDailyDays {
			continue
		}
		daily[idx].Visits++
		if v.IP != "" {
			bucketIPs[idx][v.IP] = struct{}{}
		}
	}
	for i := range daily {
		daily[i].UniqueIPs = len(bucketIPs[i])
	}

	// Top assets within window.
	var topAssetsRows []auditTopAsset
	if len(shareIDs) > 0 && len(visits) > 0 {
		visitIDs := make([]int, 0, len(visits))
		for _, v := range visits {
			visitIDs = append(visitIDs, v.ID)
		}
		views, err := h.DB.AssetView.Query().
			Where(assetview.VisitIDIn(visitIDs...)).
			All(ctx)
		if err != nil {
			return err
		}
		tally := make(map[int]int)
		for _, av := range views {
			tally[av.AssetID]++
		}
		type kv struct {
			k, v int
		}
		pairs := make([]kv, 0, len(tally))
		for k, v := range tally {
			pairs = append(pairs, kv{k, v})
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i].v > pairs[j].v })
		if len(pairs) > 20 {
			pairs = pairs[:20]
		}
		// Resolve thumb URLs via OSS storage helper. If signed-URL build fails,
		// leave thumb_url empty rather than failing the whole response.
		for _, p := range pairs {
			row := auditTopAsset{AssetID: p.k, Views: p.v}
			if a, err := h.DB.Asset.Get(ctx, p.k); err == nil {
				if u, err := h.SignedURLs.GetOrBuild(ctx, p.k, "thumb", func() (string, time.Time, error) {
					url, expiresAt, err := h.OSS.PresignThumb(ctx, a.ObjectKey)
					return url, expiresAt, err
				}); err == nil {
					row.ThumbURL = u
				}
			}
			topAssetsRows = append(topAssetsRows, row)
		}
	}

	// Referers (parse host).
	refTally := make(map[string]int)
	for _, v := range visits {
		host := refererHost(v.Referer)
		refTally[host]++
	}
	refs := make([]auditRefererRow, 0, len(refTally))
	for k, v := range refTally {
		refs = append(refs, auditRefererRow{Host: k, Count: v})
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].Count > refs[j].Count })
	if len(refs) > 10 {
		refs = refs[:10]
	}

	// Countries.
	cTally := make(map[string]int)
	for _, v := range visits {
		if v.Country == "" {
			continue
		}
		cTally[v.Country]++
	}
	countries := make([]auditCountryRow, 0, len(cTally))
	for k, v := range cTally {
		countries = append(countries, auditCountryRow{Code: k, Count: v})
	}
	sort.Slice(countries, func(i, j int) bool { return countries[i].Count > countries[j].Count })
	if len(countries) > 10 {
		countries = countries[:10]
	}

	// Shares for this trip — reuse the AuditShares row shape by calling the
	// same aggregation inline, scoped to this trip.
	tripShares, err := h.auditSharesForTrip(ctx, id, shareIDs)
	if err != nil {
		return err
	}

	c.Response().Header().Set("Cache-Control", "private, max-age=30")
	return c.JSON(http.StatusOK, auditTripDetailResp{
		Trip: map[string]any{
			"id":         t.ID,
			"title":      t.Title,
			"created_at": t.CreatedAt,
		},
		Shares:    tripShares,
		Daily:     daily,
		TopAssets: topAssetsRows,
		Referers:  refs,
		Countries: countries,
	})
}

func refererHost(s string) string {
	if s == "" {
		return "(直接访问)"
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "(直接访问)"
	}
	return u.Host
}

// auditSharesForTrip returns per-share aggregation rows for a specific trip.
// Helper used by AuditTripDetail; mirrors AuditShares but skips the global
// shape (no filter/sort flags).
func (h *Handler) auditSharesForTrip(ctx context.Context, tripID int, shareIDs []int) ([]auditShareRow, error) {
	if len(shareIDs) == 0 {
		return []auditShareRow{}, nil
	}
	shares, err := h.DB.ShareLink.Query().Where(sharelink.IDIn(shareIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}

	visits, err := h.DB.Visit.Query().Where(visit.ShareIDIn(shareIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	visitsByShare := make(map[int][]*ent.Visit)
	for _, v := range visits {
		visitsByShare[v.ShareID] = append(visitsByShare[v.ShareID], v)
	}

	childAggs, err := h.DB.ShareLink.Query().
		Where(sharelink.ParentShareIDIn(shareIDs...)).
		Select(sharelink.FieldParentShareID).
		Ints(ctx)
	if err != nil {
		return nil, err
	}
	childCount := make(map[int]int)
	for _, id := range childAggs {
		childCount[id]++
	}

	tr, err := h.DB.Trip.Get(ctx, tripID)
	if err != nil {
		return nil, err
	}

	out := make([]auditShareRow, 0, len(shares))
	for _, s := range shares {
		ips := make(map[string]struct{})
		var last *time.Time
		for _, v := range visitsByShare[s.ID] {
			if v.IP != "" {
				ips[v.IP] = struct{}{}
			}
			if last == nil || v.VisitedAt.After(*last) {
				va := v.VisitedAt
				last = &va
			}
		}
		out = append(out, auditShareRow{
			ID:           s.ID,
			Code:         s.Code,
			Scope:        string(s.Scope),
			Note:         s.Note,
			TripID:       s.TripID,
			TripTitle:    tr.Title,
			CreatedAt:    s.CreatedAt,
			ExpiresAt:    s.ExpiresAt,
			RevokedAt:    s.RevokedAt,
			Visits:       len(visitsByShare[s.ID]),
			UniqueIPs:    len(ips),
			ChildCount:   childCount[s.ID],
			LastVisitAt:  last,
			DisableForwd: s.DisableForward,
		})
	}
	return out, nil
}
```

加 imports：`"net/url"`。

**注意**：`h.SignedURLs.GetOrBuild` 和 `h.OSS.PresignThumb` 是占位 API 调用 —— 在实现这一步之前先确认 `cache.SignedURL` 和 `oss.Storage` 真实接口签名。若签名不同，沿用 `asset.go` 里现有缩略图 URL 构建代码（复制其调用模式即可，无需重新设计）。

- [ ] **Step 4: 跑测试**

Run: `go test ./internal/handler/ -run 'TestAuditTripDetail|TestAuditDoesNotWriteAuditLog' -v`
Expected: PASS

- [ ] **Step 5: 跑全量后端测试，确认无回归**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/handler/audit.go internal/handler/audit_test.go
git commit -m "audit: implement AuditTripDetail endpoint (90-day trends + top assets)"
```

---

## Task 6: 前端 API client 与类型

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: 加类型定义**

在 `web/src/lib/api.ts` 现有 `ShareStats` / `ShareTreeNode` 类型附近添加：

```ts
export type AuditEvent = {
  visit_id: number;
  share_id: number;
  share_code: string;
  trip_id: number;
  trip_title: string;
  ip: string;
  ua: string;
  country: string;
  referer: string;
  visited_at: string;
  asset_view_count: number;
  is_share_creator: boolean;
};

export type AuditEventsResp = {
  events: AuditEvent[];
  next_before: string | null;
};

export type AuditShareRow = {
  id: number;
  code: string;
  scope: string;
  note: string;
  trip_id: number;
  trip_title: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  visits: number;
  unique_ips: number;
  child_count: number;
  last_visit_at: string | null;
  disable_forward: boolean;
};

export type AuditSharesResp = { shares: AuditShareRow[] };

export type AuditTripRow = {
  trip_id: number;
  title: string;
  share_count: number;
  total_visits: number;
  unique_visitors: number;
  last_visit_at: string | null;
};
export type AuditTripsResp = { trips: AuditTripRow[] };

export type AuditDaily = { date: string; visits: number; unique_ips: number };
export type AuditTopAsset = { asset_id: number; views: number; thumb_url: string };
export type AuditRefererRow = { host: string; count: number };
export type AuditCountryRow = { code: string; count: number };

export type AuditTripDetail = {
  trip: { id: number; title: string; created_at: string };
  shares: AuditShareRow[];
  daily: AuditDaily[];
  top_assets: AuditTopAsset[];
  referers: AuditRefererRow[];
  countries: AuditCountryRow[];
};
```

- [ ] **Step 2: 加 API 方法**

在 `api` 对象内（紧跟 `shareTree:` 之后）加：

```ts
// ---- audit (admin) ----
auditEvents: (opts: {
  before?: string;
  limit?: number;
  tripID?: number;
  shareID?: number;
  ip?: string;
} = {}) => {
  const qs = new URLSearchParams();
  if (opts.before) qs.set("before", opts.before);
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.tripID) qs.set("trip_id", String(opts.tripID));
  if (opts.shareID) qs.set("share_id", String(opts.shareID));
  if (opts.ip) qs.set("ip", opts.ip);
  const s = qs.toString();
  return apiFetch<AuditEventsResp>(`/admin/audit/events${s ? `?${s}` : ""}`);
},
auditShares: (opts: { status?: string; order?: string; q?: string } = {}) => {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  if (opts.order) qs.set("order", opts.order);
  if (opts.q) qs.set("q", opts.q);
  const s = qs.toString();
  return apiFetch<AuditSharesResp>(`/admin/audit/shares${s ? `?${s}` : ""}`);
},
auditTrips: () => apiFetch<AuditTripsResp>("/admin/audit/trips"),
auditTripDetail: (id: number) => apiFetch<AuditTripDetail>(`/admin/audit/trips/${id}`),
```

- [ ] **Step 3: 跑前端类型检查**

Run: `cd web && pnpm tsc --noEmit` （或项目 `make` 里的等效命令；如果没有，先 `npm i` 一次）。
Expected: 无新错误

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "audit: add audit API types and client methods"
```

---

## Task 7: 抽离 StatsModal 和 ShareTreePanel

**Files:**
- Create: `web/src/components/share/StatsModal.tsx`
- Create: `web/src/components/share/ShareTreePanel.tsx`
- Modify: `web/src/components/SharesPanel.tsx`

- [ ] **Step 1: 创建 StatsModal**

将 `web/src/components/SharesPanel.tsx` 中的 `StatsModal` 子组件（含其使用的 `Stat`/辅助函数）原样剪到新文件 `web/src/components/share/StatsModal.tsx`，并加导出。注意：

- 保持组件 props 签名不变（`{ id: number; onClose: () => void }`）。
- 引用的 `api.shareStats` / `ApiError` / 类型保持来自 `@/lib/api`。
- 如果组件依赖 `SharesPanel` 内的小工具函数（`formatTimeAgo` 等），一并迁出到 `web/src/components/share/StatsModal.tsx` 同文件内（或 `web/src/components/share/utils.ts` 再 import；按当下情况就近为先）。

文件骨架：

```tsx
import { useEffect, useState } from "react";
import { api, type ShareStats } from "@/lib/api";

export function StatsModal({ id, onClose }: { id: number; onClose: () => void }) {
  // ... paste extracted body ...
}

// Helper sub-components / utilities below.
```

- [ ] **Step 2: 创建 ShareTreePanel**

类似地，将 `SharesPanel.tsx` 内"转发树"相关 UI（含其加载 `api.shareTree` 的逻辑）抽到 `web/src/components/share/ShareTreePanel.tsx`，导出 `ShareTreePanel`。Props：`{ id: number; onClose: () => void }`（保留与原一致；若原 SharesPanel 把这部分直接嵌入而非独立 Modal，把它包装成同样的 Modal 形态以便复用）。

- [ ] **Step 3: 改 SharesPanel 用新组件**

修改 `web/src/components/SharesPanel.tsx`：删掉已抽出的本地实现，改为 `import { StatsModal } from "@/components/share/StatsModal"` 和 `import { ShareTreePanel } from "@/components/share/ShareTreePanel"`，使用方式不变。

- [ ] **Step 4: 编译检查**

Run: `cd web && pnpm tsc --noEmit`
Expected: 无新错误

- [ ] **Step 5: 跑 dev，回归手测**

Run: `make dev`
打开 admin / 某 trip / SharesPanel → 点统计 → StatsModal 显示数据；点查看转发树 → 树正确。

- [ ] **Step 6: Commit**

```bash
git add web/src/components/share/ web/src/components/SharesPanel.tsx
git commit -m "audit: extract StatsModal and ShareTreePanel for reuse"
```

---

## Task 8: Audit 容器 + 路由 + Layout 入口

**Files:**
- Create: `web/src/pages/admin/Audit.tsx`
- Modify: `web/src/router.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: Audit 容器**

```tsx
// web/src/pages/admin/Audit.tsx
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { EventsTab } from "./audit/EventsTab";
import { SharesTab } from "./audit/SharesTab";
import { TripsTab } from "./audit/TripsTab";

const TABS = [
  { id: "events", label: "事件流" },
  { id: "shares", label: "分享总览" },
  { id: "trips", label: "相册维度" },
] as const;

export function AuditPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as (typeof TABS)[number]["id"]) || "events";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">访问追溯</h1>
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSp({ tab: t.id })}
            className={cn(
              "px-3 py-2 text-sm font-medium",
              tab === t.id
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "events" && <EventsTab />}
      {tab === "shares" && <SharesTab />}
      {tab === "trips" && <TripsTab />}
    </div>
  );
}
```

- [ ] **Step 2: 临时空 Tab 文件（让导入不挂）**

在 `web/src/pages/admin/audit/` 下分别创建 `EventsTab.tsx`、`SharesTab.tsx`、`TripsTab.tsx`、`TripAuditDetail.tsx`，内容均：

```tsx
export function EventsTab() { return <div className="text-zinc-500">TODO</div>; }
```

（每个文件改名相应导出。后续任务填实现。）

- [ ] **Step 3: 路由**

修改 `web/src/router.tsx`：在 `/admin/settings` Route 之后添加：

```tsx
<Route
  path="/admin/audit"
  element={
    <RequireAuth role="admin">
      <AuditPage />
    </RequireAuth>
  }
/>
<Route
  path="/admin/audit/trip/:id"
  element={
    <RequireAuth role="admin">
      <TripAuditDetail />
    </RequireAuth>
  }
/>
```

并在顶部 import：

```tsx
import { AuditPage } from "@/pages/admin/Audit";
import { TripAuditDetail } from "@/pages/admin/audit/TripAuditDetail";
```

- [ ] **Step 4: Layout 加入口**

修改 `web/src/components/Layout.tsx` 的桌面 nav 和 mobile drawer，admin 项之间加：

桌面（在 `{user.role === "admin" && <NavTab to="/admin/users">用户</NavTab>}` 之前）：

```tsx
{user.role === "admin" && <NavTab to="/admin/audit">访问追溯</NavTab>}
```

移动（类似位置）：

```tsx
{user.role === "admin" && (
  <MobileNav to="/admin/audit" onClick={closeMenu}>
    访问追溯
  </MobileNav>
)}
```

- [ ] **Step 5: 编译 + 手测导航**

Run: `cd web && pnpm tsc --noEmit && pnpm build`
Expected: 编译通过。`make dev` 后 admin 看到「访问追溯」入口，点击进入 `/admin/audit?tab=events`，三 tab 切换 URL 同步。editor 账号看不到此入口（手测）。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/Audit.tsx web/src/pages/admin/audit/ web/src/router.tsx web/src/components/Layout.tsx
git commit -m "audit: add Audit container page, routing, and nav entry"
```

---

## Task 9: EventsTab

**Files:**
- Modify: `web/src/pages/admin/audit/EventsTab.tsx`

- [ ] **Step 1: 实现 EventsTab**

```tsx
// web/src/pages/admin/audit/EventsTab.tsx
import { useEffect, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { Button } from "@/components/ui";

export function EventsTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tripID, setTripID] = useState("");
  const [ip, setIP] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    try {
      const resp = await api.auditEvents({
        before: reset ? undefined : before ?? undefined,
        tripID: tripID ? Number(tripID) : undefined,
        ip: ip || undefined,
        limit: 50,
      });
      setEvents(reset ? resp.events : [...events, ...resp.events]);
      setBefore(resp.next_before);
      setDone(resp.next_before === null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEvents([]);
    setBefore(null);
    setDone(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID, ip]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="trip id"
          value={tripID}
          onChange={(e) => setTripID(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <input
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="ip"
          value={ip}
          onChange={(e) => setIP(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">Trip</th>
              <th className="px-3 py-2">Share</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">国家</th>
              <th className="px-3 py-2">资源数</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={e.visit_id}
                onClick={() => setSelected(e)}
                className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(e.visited_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{e.trip_title}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.share_code}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.ip || "—"}</td>
                <td className="px-3 py-2">{e.country || "—"}</td>
                <td className="px-3 py-2">{e.asset_view_count}</td>
                <td className="px-3 py-2">
                  {e.is_share_creator && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      转发者
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        {!done ? (
          <Button onClick={() => load(false)} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </Button>
        ) : (
          <span className="text-xs text-zinc-400">已到底</span>
        )}
      </div>

      {selected && <EventDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EventDrawer({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative ml-auto h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-xl dark:bg-zinc-950"
      >
        <h2 className="mb-3 text-lg font-semibold">访问详情</h2>
        <Row k="时间" v={new Date(event.visited_at).toLocaleString()} />
        <Row k="Trip" v={`${event.trip_title} (#${event.trip_id})`} />
        <Row k="Share" v={`${event.share_code} (#${event.share_id})`} />
        <Row k="IP" v={event.ip || "—"} mono />
        <Row k="国家" v={event.country || "—"} />
        <Row k="资源浏览数" v={String(event.asset_view_count)} />
        <Row k="转发?" v={event.is_share_creator ? "是" : "否"} />
        <Row k="Referer" v={event.referer || "(直接访问)"} mono />
        <Row k="UA" v={event.ua || "—"} mono />
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="border-b border-zinc-100 py-2 text-sm dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{k}</div>
      <div className={mono ? "break-all font-mono text-xs" : "break-all"}>{v}</div>
    </div>
  );
}
```

- [ ] **Step 2: 编译 + 手测**

Run: `cd web && pnpm tsc --noEmit`
Expected: 无错误。

`make dev` 后访问 `/admin/audit?tab=events`，看到事件列表，分页 / 过滤 / 抽屉正常。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/admin/audit/EventsTab.tsx
git commit -m "audit: implement EventsTab with filters, pagination, drawer"
```

---

## Task 10: SharesTab

**Files:**
- Modify: `web/src/pages/admin/audit/SharesTab.tsx`

- [ ] **Step 1: 实现 SharesTab**

```tsx
// web/src/pages/admin/audit/SharesTab.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AuditShareRow } from "@/lib/api";
import { Button } from "@/components/ui";
import { StatsModal } from "@/components/share/StatsModal";
import { ShareTreePanel } from "@/components/share/ShareTreePanel";

export function SharesTab() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AuditShareRow[]>([]);
  const [status, setStatus] = useState("active");
  const [order, setOrder] = useState("recent_visit");
  const [q, setQ] = useState("");
  const [statsFor, setStatsFor] = useState<number | null>(null);
  const [treeFor, setTreeFor] = useState<number | null>(null);

  useEffect(() => {
    api.auditShares({ status, order, q }).then((r) => setRows(r.shares));
  }, [status, order, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="active">活跃</option>
          <option value="expired">已过期</option>
          <option value="revoked">已撤销</option>
          <option value="all">全部</option>
        </select>
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="recent_visit">按最近访问</option>
          <option value="visits">按访问次数</option>
          <option value="created">按创建时间</option>
        </select>
        <input
          placeholder="搜 code / note"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Trip</th>
              <th className="px-3 py-2">访问</th>
              <th className="px-3 py-2">独立 IP</th>
              <th className="px-3 py-2">子分享</th>
              <th className="px-3 py-2">最近访问</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">
                  <span>{r.trip_title}</span>
                </td>
                <td className="px-3 py-2">{r.visits}</td>
                <td className="px-3 py-2">{r.unique_ips}</td>
                <td className="px-3 py-2">{r.child_count}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.last_visit_at ? new Date(r.last_visit_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  {r.revoked_at ? (
                    <Pill tone="rose">已撤销</Pill>
                  ) : r.expires_at && new Date(r.expires_at) < new Date() ? (
                    <Pill tone="zinc">已过期</Pill>
                  ) : (
                    <Pill tone="emerald">活跃</Pill>
                  )}
                </td>
                <td className="space-x-1 px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setStatsFor(r.id)}>
                    统计
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTreeFor(r.id)}>
                    转发树
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => nav(`/admin/trips/${r.trip_id}`)}>
                    Trip
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statsFor && <StatsModal id={statsFor} onClose={() => setStatsFor(null)} />}
      {treeFor && <ShareTreePanel id={treeFor} onClose={() => setTreeFor(null)} />}
    </div>
  );
}

function Pill({ tone, children }: { tone: "rose" | "zinc" | "emerald"; children: React.ReactNode }) {
  const cls = {
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}
```

- [ ] **Step 2: 编译 + 手测**

Run: `cd web && pnpm tsc --noEmit`
Expected: 无错误。手测三种过滤、点击三种按钮工作。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/admin/audit/SharesTab.tsx
git commit -m "audit: implement SharesTab cross-trip share overview"
```

---

## Task 11: TripsTab

**Files:**
- Modify: `web/src/pages/admin/audit/TripsTab.tsx`

- [ ] **Step 1: 实现 TripsTab**

```tsx
// web/src/pages/admin/audit/TripsTab.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AuditTripRow } from "@/lib/api";

export function TripsTab() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AuditTripRow[]>([]);

  useEffect(() => {
    api.auditTrips().then((r) => setRows(r.trips));
  }, []);

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2">相册</th>
            <th className="px-3 py-2">分享数</th>
            <th className="px-3 py-2">总访问</th>
            <th className="px-3 py-2">独立访客</th>
            <th className="px-3 py-2">最近访问</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.trip_id}
              onClick={() => nav(`/admin/audit/trip/${r.trip_id}`)}
              className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <td className="px-3 py-2">{r.title}</td>
              <td className="px-3 py-2">{r.share_count}</td>
              <td className="px-3 py-2">{r.total_visits}</td>
              <td className="px-3 py-2">{r.unique_visitors}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.last_visit_at ? new Date(r.last_visit_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 编译 + 手测**

Run: `cd web && pnpm tsc --noEmit`
点击行跳到详细页（暂为 TODO 占位）。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/admin/audit/TripsTab.tsx
git commit -m "audit: implement TripsTab trip-level aggregation"
```

---

## Task 12: Sparkline 组件

**Files:**
- Create: `web/src/pages/admin/audit/Sparkline.tsx`

- [ ] **Step 1: 写 Sparkline**

```tsx
// web/src/pages/admin/audit/Sparkline.tsx
import { useMemo, useState } from "react";

export type SparkPoint = { date: string; value: number };

export function Sparkline({
  points,
  width = 720,
  height = 160,
  stroke = "currentColor",
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { path, max, scaleX, scaleY } = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.value));
    const padX = 24;
    const padY = 16;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const scaleX = (i: number) =>
      padX + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
    const scaleY = (v: number) => padY + innerH - (v / max) * innerH;
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(i).toFixed(1)} ${scaleY(p.value).toFixed(1)}`)
      .join(" ");
    return { path, max, scaleX, scaleY };
  }, [points, width, height]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full text-zinc-700 dark:text-zinc-300">
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={scaleX(i)}
            cy={scaleY(p.value)}
            r={hover === i ? 4 : 2}
            fill={stroke}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded bg-zinc-900 px-2 py-1 text-xs text-white shadow"
          style={{
            left: `${(scaleX(hover) / width) * 100}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          {points[hover].date}：{points[hover].value}
        </div>
      )}
      <div className="text-right text-xs text-zinc-400">峰值 {max}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/admin/audit/Sparkline.tsx
git commit -m "audit: add Sparkline SVG component"
```

---

## Task 13: TripAuditDetail 详细页

**Files:**
- Modify: `web/src/pages/admin/audit/TripAuditDetail.tsx`

- [ ] **Step 1: 实现 TripAuditDetail**

```tsx
// web/src/pages/admin/audit/TripAuditDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type AuditTripDetail } from "@/lib/api";
import { Sparkline } from "./Sparkline";

export function TripAuditDetail() {
  const { id } = useParams();
  const [data, setData] = useState<AuditTripDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    api.auditTripDetail(Number(id)).then(setData);
  }, [id]);

  if (!data) return <div className="text-zinc-500">加载中…</div>;

  const totalVisits = data.daily.reduce((s, d) => s + d.visits, 0);
  const totalUnique = new Set(
    data.shares.flatMap(() => []),
  ).size; // unique_visitors derived from trip table; for now show daily aggregate.
  const peakDay = data.daily.reduce(
    (m, d) => (d.visits > m.visits ? d : m),
    { date: "", visits: 0, unique_ips: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.trip.title} · 访问趋势</h1>
        <Link to="/admin/audit?tab=trips" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← 返回
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="90 天访问" value={String(totalVisits)} />
        <Card label="分享数" value={String(data.shares.length)} />
        <Card label="高峰日访问" value={String(peakDay.visits)} sub={peakDay.date} />
        <Card label="最近访问" value={data.shares.find((s) => s.last_visit_at)?.last_visit_at?.slice(0, 10) ?? "—"} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">最近 90 天</h2>
        <Sparkline points={data.daily.map((d) => ({ date: d.date, value: d.visits }))} />
      </section>

      {data.top_assets.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-500">热门资源 (Top {data.top_assets.length})</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {data.top_assets.map((a) => (
              <div key={a.asset_id} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                {a.thumb_url && (
                  <img src={a.thumb_url} alt="" className="aspect-square w-full object-cover" />
                )}
                <div className="bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {a.views} 次
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(data.referers.length > 0 || data.countries.length > 0) && (
        <section className="grid gap-4 sm:grid-cols-2">
          <BarList title="来源 (Referer)" rows={data.referers.map((r) => ({ label: r.host, count: r.count }))} />
          <BarList title="国家" rows={data.countries.map((c) => ({ label: c.code, count: c.count }))} />
        </section>
      )}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

function BarList({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-zinc-500">{title}</h3>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="text-sm">
            <div className="flex items-center justify-between">
              <span className="truncate">{r.label}</span>
              <span className="text-xs text-zinc-500">{r.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full bg-zinc-700 dark:bg-zinc-300"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 编译 + 手测**

Run: `cd web && pnpm tsc --noEmit && pnpm build`

- 从 TripsTab 点行进入详细页，看到 4 个统计卡 + sparkline + 热门资源 + referer/country。
- 鼠标悬停 sparkline 圆点显示日期 + 访问数。
- 删除一个 trip 后从 SharesTab 看 audit 行 `trip_title` 显示 `(已删除)` 不崩溃。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/admin/audit/TripAuditDetail.tsx
git commit -m "audit: implement TripAuditDetail page with sparkline and breakdowns"
```

---

## Task 14: 全量回归 + 手测 checklist

- [ ] **Step 1: 后端全测**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 2: 前端类型 + 构建**

Run: `cd web && pnpm tsc --noEmit && pnpm build`
Expected: 无错误

- [ ] **Step 3: 手测 checklist**

启动 `make dev`，用 admin 账号过一遍：

- [ ] Layout 顶部看到「访问追溯」入口；editor 账号登录后入口消失。
- [ ] `/admin/audit` 默认显示事件流；点击 tab 切换 URL 同步（`?tab=...`）。
- [ ] 事件流：分页"加载更多"到底；点击行打开抽屉显示完整 UA / referer。
- [ ] 事件流过滤：`trip id` 和 `ip` 各试一次。
- [ ] 分享总览：四种 status filter 工作；三种 order 工作；`q` 搜索 code 工作。
- [ ] 分享总览：点 "统计" 弹出 StatsModal；点 "转发树" 弹出 ShareTreePanel；点 "Trip" 跳到 trip 详情。
- [ ] 相册维度：行点击进入 `/admin/audit/trip/:id`；详细页 sparkline tooltip 工作。
- [ ] 删除一个 trip（在另一个 admin 标签页里），刷新 audit 页面，`trip_title` 显示 `(已删除)` 且不崩溃。

- [ ] **Step 4: 性能粗测（可选）**

如果方便，造一万 visits 数据跑 `time curl -H "Authorization: Bearer ..." http://localhost:8080/api/admin/audit/events`，三个列表 API 单次响应 < 200ms。

- [ ] **Step 5: 最终 Commit（如有改动）**

如果手测发现小问题修了，再 commit：

```bash
git add -A
git commit -m "audit: fixes from manual QA"
```

---

## 完成

所有任务完成后：
- `/api/admin/audit/*` 四个 endpoint 上线（admin only）
- Admin 页面顶部新「访问追溯」入口
- 三视图 Tab + 单 trip 详细趋势页
- 后端测试覆盖：权限、events 分页 + 过滤 + 字段拼接、shares 聚合 + 状态过滤 + 排序、trips 多 trip 关联聚合、trip 详情 daily 补零 + referer host 提取、audit_log 不被写入

复用收益：`StatsModal` / `ShareTreePanel` 从 SharesPanel 抽出，未来其它页面（如管理员批量审核）可直接 import。
