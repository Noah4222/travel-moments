package handler

import (
	"context"
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
	Events     []auditEvent `json:"events"`
	NextBefore *time.Time   `json:"next_before"`
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

	// before cursor
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
		q = q.Where(visit.VisitedAtLT(*beforeT))
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
		last := out.Events[len(out.Events)-1].VisitedAt
		out.NextBefore = &last
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

func (h *Handler) AuditShares(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTrips(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTripDetail(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}
