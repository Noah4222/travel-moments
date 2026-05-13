package handler

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/assetview"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/trip"
	"github.com/cloverstd/travel-moments/internal/ent/visit"
)

// All endpoints in this file are mounted under /api/admin/audit and require
// admin role. Group-level middleware enforces auth; handlers do not re-check.

type auditEvent struct {
	VisitID        int       `json:"visit_id"`
	ShareID        int       `json:"share_id"`
	ShareCode      string    `json:"share_code"`
	TripID         int       `json:"trip_id"`
	TripTitle      string    `json:"trip_title"`
	IP             string    `json:"ip"`
	UA             string    `json:"ua"`
	Country        string    `json:"country,omitempty"`
	Referer        string    `json:"referer,omitempty"`
	VisitedAt      time.Time `json:"visited_at"`
	AssetViewCount int       `json:"asset_view_count"`
	IsShareCreator bool      `json:"is_share_creator"`
}

type auditEventsResp struct {
	Events       []auditEvent `json:"events"`
	NextBefore   *time.Time   `json:"next_before"`
	NextBeforeID *int         `json:"next_before_id"`
}

func (h *Handler) AuditEvents(c echo.Context) error {
	ctx := c.Request().Context()

	// limit (default 50, max 200)
	limit := 50
	if s := c.QueryParam("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "bad limit")
		}
		if n > 200 {
			n = 200
		}
		limit = n
	}

	// before cursor — compound (visited_at, id). before_id is optional; when
	// absent we use a simple visited_at < t predicate (open boundary, used by
	// callers that haven't received a before_id yet).
	var beforeT *time.Time
	if s := c.QueryParam("before"); s != "" {
		t, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			// Allow plain RFC3339 too.
			t, err = time.Parse(time.RFC3339, s)
			if err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "bad before")
			}
		}
		beforeT = &t
	}
	var beforeID *int
	if s := c.QueryParam("before_id"); s != "" {
		id, err := strconv.Atoi(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad before_id")
		}
		beforeID = &id
	}

	// Build the visit query with filters.
	q := h.DB.Visit.Query()

	if s := c.QueryParam("ip"); s != "" {
		q = q.Where(visit.IPEQ(s))
	}
	if s := c.QueryParam("share_id"); s != "" {
		id, err := strconv.Atoi(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad share_id")
		}
		q = q.Where(visit.ShareIDEQ(id))
	}
	if s := c.QueryParam("trip_id"); s != "" {
		tid, err := strconv.Atoi(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "bad trip_id")
		}
		shareIDs, err := h.shareIDsForTrip(ctx, tid)
		if err != nil {
			return err
		}
		if len(shareIDs) == 0 {
			return c.JSON(http.StatusOK, auditEventsResp{Events: []auditEvent{}})
		}
		q = q.Where(visit.ShareIDIn(shareIDs...))
	}
	if beforeT != nil {
		if beforeID != nil {
			// Compound cursor: (visited_at, id) < (beforeT, beforeID) lexicographically.
			q = q.Where(visit.Or(
				visit.VisitedAtLT(*beforeT),
				visit.And(visit.VisitedAtEQ(*beforeT), visit.IDLT(*beforeID)),
			))
		} else {
			// Open boundary — caller didn't supply before_id yet.
			q = q.Where(visit.VisitedAtLT(*beforeT))
		}
	}

	visits, err := q.
		Order(ent.Desc(visit.FieldVisitedAt), ent.Desc(visit.FieldID)).
		Limit(limit + 1).
		All(ctx)
	if err != nil {
		return err
	}

	hasMore := len(visits) > limit
	if hasMore {
		visits = visits[:limit]
	}

	out := auditEventsResp{Events: make([]auditEvent, 0, len(visits))}
	if len(visits) == 0 {
		return c.JSON(http.StatusOK, out)
	}

	// Collect referenced share IDs + visit IDs.
	shareIDSet := make(map[int]struct{}, len(visits))
	visitIDs := make([]int, 0, len(visits))
	for _, v := range visits {
		shareIDSet[v.ShareID] = struct{}{}
		visitIDs = append(visitIDs, v.ID)
	}
	shareIDs := make([]int, 0, len(shareIDSet))
	for id := range shareIDSet {
		shareIDs = append(shareIDs, id)
	}

	shares, err := h.DB.ShareLink.Query().
		Where(sharelink.IDIn(shareIDs...)).
		All(ctx)
	if err != nil {
		return err
	}
	shareByID := make(map[int]*ent.ShareLink, len(shares))
	tripIDSet := make(map[int]struct{}, len(shares))
	for _, s := range shares {
		shareByID[s.ID] = s
		tripIDSet[s.TripID] = struct{}{}
	}
	tripIDs := make([]int, 0, len(tripIDSet))
	for id := range tripIDSet {
		tripIDs = append(tripIDs, id)
	}
	tripTitleByID := make(map[int]string, len(tripIDs))
	if len(tripIDs) > 0 {
		trips, err := h.DB.Trip.Query().Where(trip.IDIn(tripIDs...)).All(ctx)
		if err != nil {
			return err
		}
		for _, t := range trips {
			tripTitleByID[t.ID] = t.Title
		}
	}

	// asset_view_count per visit_id.
	viewsByVisit := make(map[int]int, len(visitIDs))
	views, err := h.DB.AssetView.Query().
		Where(assetview.VisitIDIn(visitIDs...)).
		All(ctx)
	if err != nil {
		return err
	}
	for _, v := range views {
		viewsByVisit[v.VisitID]++
	}

	// is_share_creator: visit_id that appears as creator_visit_id on any share.
	creatorIDs, err := h.DB.ShareLink.Query().
		Where(sharelink.CreatorVisitIDIn(visitIDs...)).
		Select(sharelink.FieldCreatorVisitID).
		Ints(ctx)
	if err != nil {
		return err
	}
	creatorSet := make(map[int]struct{}, len(creatorIDs))
	for _, id := range creatorIDs {
		creatorSet[id] = struct{}{}
	}

	for _, v := range visits {
		sh := shareByID[v.ShareID]
		var (
			shareCode string
			tripID    int
			tripTitle string
		)
		if sh != nil {
			shareCode = sh.Code
			tripID = sh.TripID
			if title, ok := tripTitleByID[sh.TripID]; ok {
				tripTitle = title
			} else {
				tripTitle = "(已删除)"
			}
		} else {
			tripTitle = "(已删除)"
		}
		_, isCreator := creatorSet[v.ID]
		out.Events = append(out.Events, auditEvent{
			VisitID:        v.ID,
			ShareID:        v.ShareID,
			ShareCode:      shareCode,
			TripID:         tripID,
			TripTitle:      tripTitle,
			IP:             v.IP,
			UA:             truncString(v.Ua, 200),
			Country:        v.Country,
			Referer:        v.Referer,
			VisitedAt:      v.VisitedAt,
			AssetViewCount: viewsByVisit[v.ID],
			IsShareCreator: isCreator,
		})
	}

	if hasMore {
		lastEvent := out.Events[len(out.Events)-1]
		lastT := lastEvent.VisitedAt
		lastID := lastEvent.VisitID
		out.NextBefore = &lastT
		out.NextBeforeID = &lastID
	}

	return c.JSON(http.StatusOK, out)
}

// shareIDsForTrip returns all share IDs whose primary trip is tripID OR whose
// extra_trips (share_trips join) include tripID.
func (h *Handler) shareIDsForTrip(ctx context.Context, tripID int) ([]int, error) {
	ids, err := h.DB.ShareLink.Query().
		Where(
			sharelink.Or(
				sharelink.TripIDEQ(tripID),
				sharelink.HasExtraTripsWith(trip.IDEQ(tripID)),
			),
		).
		IDs(ctx)
	if err != nil {
		return nil, err
	}
	return ids, nil
}

type auditShareRow struct {
	ID             int        `json:"id"`
	Code           string     `json:"code"`
	Scope          string     `json:"scope"`
	Note           string     `json:"note"`
	TripID         int        `json:"trip_id"`
	TripTitle      string     `json:"trip_title"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at"`
	RevokedAt      *time.Time `json:"revoked_at"`
	Visits         int        `json:"visits"`
	UniqueIPs      int        `json:"unique_ips"`
	ChildCount     int        `json:"child_count"`
	LastVisitAt    *time.Time `json:"last_visit_at"`
	DisableForward bool       `json:"disable_forward"`
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
	switch status {
	case "active", "expired", "revoked", "all":
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "bad status")
	}

	order := c.QueryParam("order")
	if order == "" {
		order = "recent_visit"
	}
	switch order {
	case "recent_visit", "visits", "created":
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "bad order")
	}

	qstr := strings.ToLower(strings.TrimSpace(c.QueryParam("q")))

	shares, err := h.DB.ShareLink.Query().All(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	// Filter by status + q.
	filtered := make([]*ent.ShareLink, 0, len(shares))
	for _, s := range shares {
		// status
		isRevoked := s.RevokedAt != nil
		isExpired := !isRevoked && s.ExpiresAt != nil && s.ExpiresAt.Before(now)
		isActive := !isRevoked && !isExpired
		switch status {
		case "active":
			if !isActive {
				continue
			}
		case "expired":
			if !isExpired {
				continue
			}
		case "revoked":
			if !isRevoked {
				continue
			}
		}
		// q
		if qstr != "" {
			if !strings.Contains(strings.ToLower(s.Code), qstr) &&
				!strings.Contains(strings.ToLower(s.Note), qstr) {
				continue
			}
		}
		filtered = append(filtered, s)
	}

	// Aggregate visits across all shares (one query, tally in Go).
	type visitAgg struct {
		count   int
		ips     map[string]struct{}
		lastVis *time.Time
	}
	aggByShare := make(map[int]*visitAgg)
	visits, err := h.DB.Visit.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, v := range visits {
		a, ok := aggByShare[v.ShareID]
		if !ok {
			a = &visitAgg{ips: make(map[string]struct{})}
			aggByShare[v.ShareID] = a
		}
		a.count++
		if v.IP != "" {
			a.ips[v.IP] = struct{}{}
		}
		if a.lastVis == nil || v.VisitedAt.After(*a.lastVis) {
			vt := v.VisitedAt
			a.lastVis = &vt
		}
	}

	// Child counts: parent_share_id values.
	parentIDs, err := h.DB.ShareLink.Query().
		Where(sharelink.ParentShareIDNotNil()).
		Select(sharelink.FieldParentShareID).
		Ints(ctx)
	if err != nil {
		return err
	}
	childCountByParent := make(map[int]int, len(parentIDs))
	for _, pid := range parentIDs {
		childCountByParent[pid]++
	}

	// Trip titles for filtered shares.
	tripIDSet := make(map[int]struct{}, len(filtered))
	for _, s := range filtered {
		tripIDSet[s.TripID] = struct{}{}
	}
	tripIDs := make([]int, 0, len(tripIDSet))
	for id := range tripIDSet {
		tripIDs = append(tripIDs, id)
	}
	tripTitleByID := make(map[int]string, len(tripIDs))
	if len(tripIDs) > 0 {
		trips, err := h.DB.Trip.Query().Where(trip.IDIn(tripIDs...)).All(ctx)
		if err != nil {
			return err
		}
		for _, t := range trips {
			tripTitleByID[t.ID] = t.Title
		}
	}

	rows := make([]auditShareRow, 0, len(filtered))
	for _, s := range filtered {
		title, ok := tripTitleByID[s.TripID]
		if !ok {
			title = "(已删除)"
		}
		row := auditShareRow{
			ID:             s.ID,
			Code:           s.Code,
			Scope:          string(s.Scope),
			Note:           s.Note,
			TripID:         s.TripID,
			TripTitle:      title,
			CreatedAt:      s.CreatedAt,
			ExpiresAt:      s.ExpiresAt,
			RevokedAt:      s.RevokedAt,
			ChildCount:     childCountByParent[s.ID],
			DisableForward: s.DisableForward,
		}
		if a := aggByShare[s.ID]; a != nil {
			row.Visits = a.count
			row.UniqueIPs = len(a.ips)
			row.LastVisitAt = a.lastVis
		}
		rows = append(rows, row)
	}

	switch order {
	case "visits":
		sort.SliceStable(rows, func(i, j int) bool {
			return rows[i].Visits > rows[j].Visits
		})
	case "created":
		sort.SliceStable(rows, func(i, j int) bool {
			return rows[i].CreatedAt.After(rows[j].CreatedAt)
		})
	case "recent_visit":
		sort.SliceStable(rows, func(i, j int) bool {
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
			if a.Equal(*b) {
				return rows[i].CreatedAt.After(rows[j].CreatedAt)
			}
			return a.After(*b)
		})
	}

	return c.JSON(http.StatusOK, auditSharesResp{Shares: rows})
}

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

	// trip_id -> set of share_ids attached (primary OR via share_trips).
	tripShareIDs := make(map[int]map[int]struct{})
	addAttach := func(tripID, shareID int) {
		set, ok := tripShareIDs[tripID]
		if !ok {
			set = make(map[int]struct{})
			tripShareIDs[tripID] = set
		}
		set[shareID] = struct{}{}
	}

	shares, err := h.DB.ShareLink.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, s := range shares {
		addAttach(s.TripID, s.ID)
	}
	shareTrips, err := h.DB.ShareTrip.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, r := range shareTrips {
		addAttach(r.TripID, r.ShareID)
	}

	// Group visits by share_id.
	type visitInfo struct {
		ip        string
		visitedAt time.Time
	}
	visitsByShare := make(map[int][]visitInfo)
	visits, err := h.DB.Visit.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, v := range visits {
		visitsByShare[v.ShareID] = append(visitsByShare[v.ShareID], visitInfo{ip: v.IP, visitedAt: v.VisitedAt})
	}

	rows := make([]auditTripRow, 0, len(trips))
	for _, t := range trips {
		shareIDs := tripShareIDs[t.ID]
		row := auditTripRow{
			TripID:     t.ID,
			Title:      t.Title,
			ShareCount: len(shareIDs),
		}
		ipSet := make(map[string]struct{})
		var lastVis *time.Time
		for sid := range shareIDs {
			for _, vi := range visitsByShare[sid] {
				row.TotalVisits++
				if vi.ip != "" {
					ipSet[vi.ip] = struct{}{}
				}
				if lastVis == nil || vi.visitedAt.After(*lastVis) {
					vt := vi.visitedAt
					lastVis = &vt
				}
			}
		}
		row.UniqueVisitors = len(ipSet)
		row.LastVisitAt = lastVis
		rows = append(rows, row)
	}

	// Sort: last_visit_at desc, nulls last; tie-break by trip_id desc.
	sort.SliceStable(rows, func(i, j int) bool {
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
		if a.Equal(*b) {
			return rows[i].TripID > rows[j].TripID
		}
		return a.After(*b)
	})

	return c.JSON(http.StatusOK, auditTripsResp{Trips: rows})
}

func (h *Handler) AuditTripDetail(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}
