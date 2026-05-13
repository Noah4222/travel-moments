package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/assetview"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/visit"
)

// ---- Stats ----

type shareStatsResp struct {
	ShareID         int             `json:"share_id"`
	Visits          int             `json:"visits"`
	UniqueIPs       int             `json:"unique_ips"`
	ChildShareCount int             `json:"child_share_count"`
	AssetViews      int             `json:"asset_views"`
	TopAssets       []topAssetStat  `json:"top_assets"`
	RecentVisits    []recentVisit   `json:"recent_visits"`
}

type topAssetStat struct {
	AssetID int `json:"asset_id"`
	Views   int `json:"views"`
}

type recentVisit struct {
	ID        int       `json:"id"`
	IP        string    `json:"ip"`
	UA        string    `json:"ua"`
	Country   string    `json:"country,omitempty"`
	Referer   string    `json:"referer,omitempty"`
	VisitedAt time.Time `json:"visited_at"`
}

func (h *Handler) ShareStats(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	if err := h.ensureShareAccess(c, id); err != nil {
		return err
	}

	ctx := c.Request().Context()
	visits, err := h.DB.Visit.Query().
		Where(visit.ShareIDEQ(id)).
		Order(ent.Desc(visit.FieldVisitedAt)).
		All(ctx)
	if err != nil {
		return err
	}
	ipSet := make(map[string]struct{}, len(visits))
	visitIDs := make([]int, len(visits))
	for i, v := range visits {
		visitIDs[i] = v.ID
		if v.IP != "" {
			ipSet[v.IP] = struct{}{}
		}
	}

	childCount, err := h.DB.ShareLink.Query().
		Where(sharelink.ParentShareIDEQ(id)).
		Count(ctx)
	if err != nil {
		return err
	}

	out := shareStatsResp{
		ShareID:         id,
		Visits:          len(visits),
		UniqueIPs:       len(ipSet),
		ChildShareCount: childCount,
		// Ensure JSON renders `[]` instead of `null` even when there are no
		// visits/views yet — the frontend assumes these are always arrays.
		TopAssets:    []topAssetStat{},
		RecentVisits: []recentVisit{},
	}

	if len(visitIDs) > 0 {
		views, err := h.DB.AssetView.Query().
			Where(assetview.VisitIDIn(visitIDs...)).
			All(ctx)
		if err != nil {
			return err
		}
		out.AssetViews = len(views)

		tally := make(map[int]int)
		for _, v := range views {
			tally[v.AssetID]++
		}
		out.TopAssets = topN(tally, 10)
	}

	limit := 50
	if len(visits) < limit {
		limit = len(visits)
	}
	out.RecentVisits = make([]recentVisit, 0, limit)
	for _, v := range visits[:limit] {
		out.RecentVisits = append(out.RecentVisits, recentVisit{
			ID:        v.ID,
			IP:        v.IP,
			UA:        truncString(v.Ua, 200),
			Country:   v.Country,
			Referer:   v.Referer,
			VisitedAt: v.VisitedAt,
		})
	}
	return c.JSON(http.StatusOK, out)
}

// ---- Tree ----

type shareTreeNode struct {
	ID            int             `json:"id"`
	Code          string          `json:"code"`
	ParentShareID *int            `json:"parent_share_id,omitempty"`
	CreatedByID   *int            `json:"created_by_user_id,omitempty"`
	CreatorVisit  *int            `json:"creator_visit_id,omitempty"`
	Note          string          `json:"note,omitempty"`
	RevokedAt     *time.Time      `json:"revoked_at,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	Children      []shareTreeNode `json:"children,omitempty"`
}

func (h *Handler) ShareTree(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	if err := h.ensureShareAccess(c, id); err != nil {
		return err
	}

	ctx := c.Request().Context()
	root, err := h.DB.ShareLink.Get(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	// Collect entire subtree by BFS.
	all := []*ent.ShareLink{root}
	queue := []int{root.ID}
	for len(queue) > 0 {
		children, err := h.DB.ShareLink.Query().
			Where(sharelink.ParentShareIDIn(queue...)).
			All(ctx)
		if err != nil {
			return err
		}
		if len(children) == 0 {
			break
		}
		all = append(all, children...)
		queue = queue[:0]
		for _, ch := range children {
			queue = append(queue, ch.ID)
		}
	}
	tree := buildTree(all, root.ID)
	return c.JSON(http.StatusOK, tree)
}

// ---- helpers ----

// ensureShareAuditAccess: visit logs / propagation trees are admin-only.
// Editors can create + revoke their shares but cannot see who clicked.
func (h *Handler) ensureShareAccess(c echo.Context, shareID int) error {
	if _, err := h.DB.ShareLink.Get(c.Request().Context(), shareID); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "share not found")
	}
	claims := auth.MustClaims(c)
	if claims.Role != auth.RoleAdmin {
		return echo.NewHTTPError(http.StatusForbidden, "admin only")
	}
	return nil
}

func buildTree(all []*ent.ShareLink, rootID int) shareTreeNode {
	byParent := make(map[int][]*ent.ShareLink)
	var root *ent.ShareLink
	for _, l := range all {
		if l.ID == rootID {
			root = l
			continue
		}
		if l.ParentShareID != nil {
			byParent[*l.ParentShareID] = append(byParent[*l.ParentShareID], l)
		}
	}
	if root == nil {
		return shareTreeNode{}
	}
	var build func(*ent.ShareLink) shareTreeNode
	build = func(l *ent.ShareLink) shareTreeNode {
		node := shareTreeNode{
			ID:            l.ID,
			Code:          l.Code,
			ParentShareID: l.ParentShareID,
			CreatedByID:   l.CreatedByUserID,
			CreatorVisit:  l.CreatorVisitID,
			Note:          l.Note,
			RevokedAt:     l.RevokedAt,
			CreatedAt:     l.CreatedAt,
		}
		for _, ch := range byParent[l.ID] {
			node.Children = append(node.Children, build(ch))
		}
		return node
	}
	return build(root)
}

func topN(tally map[int]int, n int) []topAssetStat {
	out := make([]topAssetStat, 0, len(tally))
	for k, v := range tally {
		out = append(out, topAssetStat{AssetID: k, Views: v})
	}
	// simple insertion sort by views desc; fine for small n.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Views > out[j-1].Views; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func truncString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

var _ = context.Background
