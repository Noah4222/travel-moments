package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/ent/collectionasset"
	"github.com/cloverstd/travel-moments/internal/ent/comment"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
)

// ---- DTOs ----

type commentDTO struct {
	ID          int        `json:"id"`
	TargetType  string     `json:"target_type"`
	TargetID    int        `json:"target_id"`
	DisplayName string     `json:"display_name"`
	Content     string     `json:"content"`
	Color       string     `json:"color,omitempty"`
	VideoTimeMs *int       `json:"video_time_ms,omitempty"`
	UserID      *int       `json:"user_id,omitempty"`
	IsAdmin     bool       `json:"is_admin"`
	HiddenAt    *time.Time `json:"hidden_at,omitempty"`
	EditedAt    *time.Time `json:"edited_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type postCommentReq struct {
	TargetType  string `json:"target_type"`
	TargetID    int    `json:"target_id"`
	DisplayName string `json:"display_name"`
	Content     string `json:"content"`
	Color       string `json:"color"`
	VideoTimeMs *int   `json:"video_time_ms"`
}

// ---- Public: post + list ----

const (
	maxCommentLen = 200
	maxNameLen    = 40
	rateWindow    = time.Minute
	rateLimit     = 8
)

var commentLimiter = newCommentLimiter()

func (h *Handler) PublicPostComment(c echo.Context) error {
	sess := auth.MustShareSession(c)
	link, err := h.loadActiveShare(c.Request().Context(), sess.ShareID)
	if err != nil {
		return err
	}
	var req postCommentReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if err := validateComment(&req); err != nil {
		return err
	}
	if err := h.assertCommentTargetVisible(c.Request().Context(), link, req.TargetType, req.TargetID); err != nil {
		return err
	}
	if !commentLimiter.allow(sess.VisitID) {
		return echo.NewHTTPError(http.StatusTooManyRequests, "slow down")
	}

	cr := h.DB.Comment.Create().
		SetTargetType(comment.TargetType(req.TargetType)).
		SetTargetID(req.TargetID).
		SetVisitID(sess.VisitID).
		SetDisplayName(req.DisplayName).
		SetContent(req.Content)
	if req.Color != "" {
		cr = cr.SetColor(req.Color)
	}
	if req.VideoTimeMs != nil {
		cr = cr.SetVideoTimeMs(*req.VideoTimeMs)
	}
	if req.TargetType == string(comment.TargetTypeAsset) {
		cr = cr.SetAssetID(req.TargetID)
	}
	cm, err := cr.Save(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, h.toCommentDTO(cm))
}

func (h *Handler) PublicListComments(c echo.Context) error {
	sess := auth.MustShareSession(c)
	link, err := h.loadActiveShare(c.Request().Context(), sess.ShareID)
	if err != nil {
		return err
	}
	targetType := c.QueryParam("target_type")
	targetID, _ := strconv.Atoi(c.QueryParam("target_id"))
	if targetType == "" || targetID == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "target_type and target_id required")
	}
	if err := h.assertCommentTargetVisible(c.Request().Context(), link, targetType, targetID); err != nil {
		return err
	}
	cms, err := h.DB.Comment.Query().
		Where(comment.TargetTypeEQ(comment.TargetType(targetType)),
			comment.TargetIDEQ(targetID),
			comment.HiddenAtIsNil()).
		Order(ent.Asc(comment.FieldCreatedAt)).
		All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]commentDTO, len(cms))
	for i, cm := range cms {
		out[i] = h.toCommentDTO(cm)
	}
	return c.JSON(http.StatusOK, out)
}

// ---- Admin: list / hide / edit ----

func (h *Handler) AdminListComments(c echo.Context) error {
	tripID, _ := strconv.Atoi(c.QueryParam("trip_id"))
	includeHidden := c.QueryParam("include_hidden") == "1"
	q := h.DB.Comment.Query().Order(ent.Desc(comment.FieldCreatedAt)).Limit(200)
	if !includeHidden {
		q = q.Where(comment.HiddenAtIsNil())
	}
	cms, err := q.All(c.Request().Context())
	if err != nil {
		return err
	}
	if tripID > 0 {
		assetIDs, err := h.DB.Asset.Query().Where(asset.TripIDEQ(tripID)).IDs(c.Request().Context())
		if err != nil {
			return err
		}
		assetSet := make(map[int]struct{}, len(assetIDs))
		for _, id := range assetIDs {
			assetSet[id] = struct{}{}
		}
		filtered := cms[:0]
		for _, cm := range cms {
			if cm.TargetType == comment.TargetTypeTrip && cm.TargetID == tripID {
				filtered = append(filtered, cm)
				continue
			}
			if cm.TargetType == comment.TargetTypeAsset {
				if _, ok := assetSet[cm.TargetID]; ok {
					filtered = append(filtered, cm)
				}
			}
		}
		cms = filtered
	}
	out := make([]commentDTO, len(cms))
	for i, cm := range cms {
		out[i] = h.toCommentDTO(cm)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) AdminHideComment(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	claims := auth.MustClaims(c)
	if _, err := h.DB.Comment.UpdateOneID(id).
		SetHiddenAt(time.Now()).
		SetHiddenByID(claims.UserID).
		Save(c.Request().Context()); err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "comment not found")
		}
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) AdminUnhideComment(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	if _, err := h.DB.Comment.UpdateOneID(id).
		ClearHiddenAt().
		ClearHiddenByID().
		Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type editCommentReq struct {
	Content     *string `json:"content,omitempty"`
	DisplayName *string `json:"display_name,omitempty"`
}

func (h *Handler) AdminEditComment(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	var req editCommentReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	upd := h.DB.Comment.UpdateOneID(id).SetEditedAt(time.Now())
	if req.Content != nil {
		s := sanitizeText(*req.Content, maxCommentLen)
		if s == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "content empty")
		}
		upd = upd.SetContent(s)
	}
	if req.DisplayName != nil {
		s := sanitizeText(*req.DisplayName, maxNameLen)
		if s == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "name empty")
		}
		upd = upd.SetDisplayName(s)
	}
	if _, err := upd.Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- helpers ----

func (h *Handler) toCommentDTO(cm *ent.Comment) commentDTO {
	return commentDTO{
		ID:          cm.ID,
		TargetType:  string(cm.TargetType),
		TargetID:    cm.TargetID,
		DisplayName: cm.DisplayName,
		Content:     cm.Content,
		Color:       cm.Color,
		VideoTimeMs: cm.VideoTimeMs,
		UserID:      cm.UserID,
		IsAdmin:     cm.UserID != nil,
		HiddenAt:    cm.HiddenAt,
		EditedAt:    cm.EditedAt,
		CreatedAt:   cm.CreatedAt,
	}
}

func (h *Handler) assertCommentTargetVisible(ctx context.Context, link *ent.ShareLink, targetType string, targetID int) error {
	switch targetType {
	case string(comment.TargetTypeTrip):
		if targetID != link.TripID {
			return echo.NewHTTPError(http.StatusForbidden, "trip not in scope")
		}
		return nil
	case string(comment.TargetTypeAsset):
		a, err := h.DB.Asset.Get(ctx, targetID)
		if err != nil {
			return echo.NewHTTPError(http.StatusNotFound, "asset not found")
		}
		if a.TripID != link.TripID {
			return echo.NewHTTPError(http.StatusForbidden, "asset not in scope")
		}
		if link.Scope == sharelink.ScopeCollection && link.CollectionID != nil {
			ok, err := h.DB.CollectionAsset.Query().
				Where(collectionasset.CollectionIDEQ(*link.CollectionID),
					collectionasset.AssetIDEQ(a.ID)).
				Exist(ctx)
			if err != nil {
				return err
			}
			if !ok {
				return echo.NewHTTPError(http.StatusForbidden, "asset not in shared collection")
			}
		}
		return nil
	}
	return echo.NewHTTPError(http.StatusBadRequest, "unknown target_type")
}

func validateComment(req *postCommentReq) error {
	req.DisplayName = sanitizeText(req.DisplayName, maxNameLen)
	req.Content = sanitizeText(req.Content, maxCommentLen)
	if req.DisplayName == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "display_name required")
	}
	if req.Content == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "content required")
	}
	if req.TargetType != string(comment.TargetTypeTrip) && req.TargetType != string(comment.TargetTypeAsset) {
		return echo.NewHTTPError(http.StatusBadRequest, "target_type must be trip or asset")
	}
	if req.TargetID == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "target_id required")
	}
	return nil
}

// sanitizeText strips angle brackets, trims, and truncates to maxRunes runes.
func sanitizeText(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer("<", "", ">", "").Replace(s)
	if utf8.RuneCountInString(s) > maxRunes {
		runes := []rune(s)
		s = string(runes[:maxRunes])
	}
	return s
}

// ---- rate limiter ----

type cmtBucket struct {
	count int
	reset time.Time
}

type cmtLimiter struct {
	mu sync.Mutex
	b  map[int]*cmtBucket
}

func newCommentLimiter() *cmtLimiter {
	return &cmtLimiter{b: make(map[int]*cmtBucket)}
}

func (l *cmtLimiter) allow(visitID int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.b[visitID]
	if !ok || now.After(b.reset) {
		l.b[visitID] = &cmtBucket{count: 1, reset: now.Add(rateWindow)}
		return true
	}
	if b.count >= rateLimit {
		return false
	}
	b.count++
	return true
}
