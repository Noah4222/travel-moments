package handler

import (
	"crypto/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/visit"
)

// ---- DTOs ----

type shareDTO struct {
	ID             int        `json:"id"`
	Scope          string     `json:"scope"`
	TripID         int        `json:"trip_id"`
	CollectionID   *int       `json:"collection_id,omitempty"`
	AssetID        *int       `json:"asset_id,omitempty"`
	Code           string     `json:"code"`
	URL            string     `json:"url"`
	DisableForward bool       `json:"disable_forward,omitempty"`
	Note          string     `json:"note,omitempty"`
	ParentShareID *int       `json:"parent_share_id,omitempty"`
	CreatedByID   *int       `json:"created_by_user_id,omitempty"`
	MaxUses       *int       `json:"max_uses,omitempty"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type createShareReq struct {
	Note           string     `json:"note"`
	MaxUses        *int       `json:"max_uses"`
	ExpiresAt      *time.Time `json:"expires_at"`
	DisableForward bool       `json:"disable_forward"`
}

type createShareResp struct {
	shareDTO
	Password string `json:"password"` // returned ONCE upon creation
}

// ---- Trip-level: create / list ----

func (h *Handler) CreateTripShare(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripWriteAccess(c, id); err != nil {
		return err
	}
	var req createShareReq
	_ = c.Bind(&req)

	claims := auth.MustClaims(c)
	code := randomToken(8)
	password := randomToken(8)
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	cr := h.DB.ShareLink.Create().
		SetScope(sharelink.ScopeTrip).
		SetTripID(id).
		SetCode(code).
		SetPasswordHash(hash).
		SetCreatedByUserID(claims.UserID).
		SetNote(req.Note).
		SetDisableForward(req.DisableForward)
	if req.MaxUses != nil {
		cr = cr.SetMaxUses(*req.MaxUses)
	}
	if req.ExpiresAt != nil {
		cr = cr.SetExpiresAt(*req.ExpiresAt)
	}
	link, err := cr.Save(c.Request().Context())
	if err != nil {
		return err
	}
	dto := toShareDTO(link)
	return c.JSON(http.StatusCreated, createShareResp{shareDTO: dto, Password: password})
}

// toShareDTO override: pick /a/ or /s/ based on scope.
// (See toShareDTO in share.go; we extend URL there.)

func (h *Handler) ListTripShares(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	claims := auth.MustClaims(c)
	q := h.DB.ShareLink.Query().Where(sharelink.TripIDEQ(id)).
		Order(ent.Desc(sharelink.FieldCreatedAt))
	if claims.Role != auth.RoleAdmin {
		q = q.Where(sharelink.CreatedByUserIDEQ(claims.UserID))
	}
	links, err := q.All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]shareDTO, len(links))
	for i, l := range links {
		out[i] = toShareDTO(l)
	}
	return c.JSON(http.StatusOK, out)
}

// ---- Revoke ----

func (h *Handler) RevokeShare(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	cascade := c.QueryParam("cascade") == "1" || c.QueryParam("cascade") == "true"

	link, err := h.DB.ShareLink.Get(c.Request().Context(), id)
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "share not found")
		}
		return err
	}
	// Permission: admin or creator (editor) of this share.
	claims := auth.MustClaims(c)
	if claims.Role != auth.RoleAdmin {
		if link.CreatedByUserID == nil || *link.CreatedByUserID != claims.UserID {
			return echo.NewHTTPError(http.StatusForbidden, "not your share")
		}
	}

	now := time.Now()
	ids := []int{link.ID}
	if cascade {
		extra, err := h.collectDescendantShareIDs(c, link.ID)
		if err != nil {
			return err
		}
		ids = append(ids, extra...)
	}
	if _, err := h.DB.ShareLink.Update().
		Where(sharelink.IDIn(ids...), sharelink.RevokedAtIsNil()).
		SetRevokedAt(now).
		Save(c.Request().Context()); err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"revoked_ids": ids})
}

func (h *Handler) collectDescendantShareIDs(ctx echo.Context, rootID int) ([]int, error) {
	var ids []int
	cur := []int{rootID}
	for len(cur) > 0 {
		children, err := h.DB.ShareLink.Query().
			Where(sharelink.ParentShareIDIn(cur...)).
			IDs(ctx.Request().Context())
		if err != nil {
			return nil, err
		}
		_ = ctx
		if len(children) == 0 {
			break
		}
		ids = append(ids, children...)
		cur = children
	}
	return ids, nil
}

// ---- Public: verify password & start share session ----

type authShareReq struct {
	Password string `json:"password"`
}

type authShareResp struct {
	ShareID  int    `json:"share_id"`
	TripID   int    `json:"trip_id"`
	Scope    string `json:"scope"`
	AssetID  *int   `json:"asset_id,omitempty"`
	ExpireIn int    `json:"expires_in_seconds"`
}

func (h *Handler) AuthShare(c echo.Context) error {
	code := c.Param("code")
	if code == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "code required")
	}
	var req authShareReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	link, err := h.DB.ShareLink.Query().
		Where(sharelink.CodeEQ(code)).
		Only(c.Request().Context())
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "invalid share")
		}
		return err
	}
	if link.RevokedAt != nil {
		return echo.NewHTTPError(http.StatusGone, "share revoked")
	}
	if link.ExpiresAt != nil && time.Now().After(*link.ExpiresAt) {
		return echo.NewHTTPError(http.StatusGone, "share expired")
	}
	if link.MaxUses != nil && *link.MaxUses > 0 {
		// Count visits — if exceeded, deny.
		visits, _ := h.DB.Visit.Query().Where(visit.ShareIDEQ(link.ID)).Count(c.Request().Context())
		if visits >= *link.MaxUses {
			return echo.NewHTTPError(http.StatusGone, "share usage limit reached")
		}
	}
	// Empty password_hash means a no-password share (single-asset links).
	if link.PasswordHash != "" {
		if !auth.VerifyPassword(link.PasswordHash, req.Password) {
			return echo.NewHTTPError(http.StatusUnauthorized, "wrong password")
		}
	}

	// Create Visit record.
	sessionID := uuid.NewString()
	v, err := h.DB.Visit.Create().
		SetShareID(link.ID).
		SetSessionID(sessionID).
		SetIP(realIP(c)).
		SetUa(c.Request().UserAgent()).
		SetReferer(c.Request().Referer()).
		SetVisitedAt(time.Now()).
		Save(c.Request().Context())
	if err != nil {
		return err
	}

	tok, exp, err := h.ShareJWT.Issue(link.ID, v.ID, link.Code, h.Cfg.ShareSessionTTL)
	if err != nil {
		return err
	}
	auth.SetShareCookie(c, tok, exp, h.Cfg.SecureCookies)

	return c.JSON(http.StatusOK, authShareResp{
		ShareID:  link.ID,
		TripID:   link.TripID,
		Scope:    string(link.Scope),
		AssetID:  link.AssetID,
		ExpireIn: int(time.Until(exp).Seconds()),
	})
}

// ShareInfo returns scope + whether a password is required, so the front-end
// knows whether to show the password prompt before calling AuthShare.
func (h *Handler) ShareInfo(c echo.Context) error {
	code := c.Param("code")
	link, err := h.DB.ShareLink.Query().Where(sharelink.CodeEQ(code)).Only(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	if link.RevokedAt != nil {
		return echo.NewHTTPError(http.StatusGone, "revoked")
	}
	return c.JSON(http.StatusOK, map[string]any{
		"scope":             string(link.Scope),
		"trip_id":           link.TripID,
		"asset_id":          link.AssetID,
		"requires_password": link.PasswordHash != "",
		"note":              link.Note,
	})
}

// CreateMultiShare bundles several trips into one shared link. Visitors land
// on a list of trips and drill into each one. Admin (any trip) or editor (only
// trips they own) can create one.
type createMultiShareReq struct {
	createShareReq
	TripIDs []int `json:"trip_ids"`
}

func (h *Handler) CreateMultiShare(c echo.Context) error {
	var req createMultiShareReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if len(req.TripIDs) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "trip_ids required")
	}
	// Dedup while preserving order.
	seen := make(map[int]struct{}, len(req.TripIDs))
	tripIDs := req.TripIDs[:0]
	for _, id := range req.TripIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		tripIDs = append(tripIDs, id)
	}
	for _, id := range tripIDs {
		if err := h.ensureTripWriteAccess(c, id); err != nil {
			return err
		}
	}

	claims := auth.MustClaims(c)
	code := randomToken(8)
	password := randomToken(8)
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Tx(ctx)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	cr := tx.ShareLink.Create().
		SetScope(sharelink.ScopeMulti).
		SetTripID(tripIDs[0]).
		SetCode(code).
		SetPasswordHash(hash).
		SetCreatedByUserID(claims.UserID).
		SetNote(req.Note).
		SetDisableForward(req.DisableForward)
	if req.MaxUses != nil {
		cr = cr.SetMaxUses(*req.MaxUses)
	}
	if req.ExpiresAt != nil {
		cr = cr.SetExpiresAt(*req.ExpiresAt)
	}
	link, err := cr.Save(ctx)
	if err != nil {
		return err
	}
	for i, tid := range tripIDs {
		if _, err := tx.ShareTrip.Create().
			SetShareID(link.ID).
			SetTripID(tid).
			SetSortOrder(i).
			Save(ctx); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true

	dto := toShareDTO(link)
	return c.JSON(http.StatusCreated, createShareResp{shareDTO: dto, Password: password})
}

// CreateAssetShare creates a no-password share for a single asset.
func (h *Handler) CreateAssetShare(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	a, err := h.DB.Asset.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "asset not found")
	}
	if err := h.ensureTripWriteAccess(c, a.TripID); err != nil {
		return err
	}
	var req createShareReq
	_ = c.Bind(&req)

	claims := auth.MustClaims(c)
	cr := h.DB.ShareLink.Create().
		SetScope(sharelink.ScopeAsset).
		SetTripID(a.TripID).
		SetAssetID(a.ID).
		SetCode(randomToken(8)).
		SetCreatedByUserID(claims.UserID).
		SetNote(req.Note).
		SetDisableForward(req.DisableForward)
	if req.MaxUses != nil {
		cr = cr.SetMaxUses(*req.MaxUses)
	}
	if req.ExpiresAt != nil {
		cr = cr.SetExpiresAt(*req.ExpiresAt)
	} else if h.Settings != nil {
		cr = cr.SetExpiresAt(time.Now().Add(h.Settings.AssetShareTTL()))
	}
	link, err := cr.Save(c.Request().Context())
	if err != nil {
		return err
	}
	dto := toShareDTO(link)
	dto.URL = "/a/" + link.Code
	return c.JSON(http.StatusCreated, createShareResp{shareDTO: dto, Password: ""})
}

func (h *Handler) Logout(c echo.Context) error {
	auth.ClearShareCookie(c)
	return c.NoContent(http.StatusNoContent)
}

// ---- helpers ----

const tokenAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // exclude I L O 0 1

func randomToken(n int) string {
	buf := make([]byte, n)
	rb := make([]byte, n)
	if _, err := rand.Read(rb); err != nil {
		panic(err)
	}
	for i, b := range rb {
		buf[i] = tokenAlphabet[int(b)%len(tokenAlphabet)]
	}
	return string(buf)
}

func toShareDTO(l *ent.ShareLink) shareDTO {
	prefix := "/s/"
	if l.Scope == sharelink.ScopeAsset {
		prefix = "/a/"
	}
	return shareDTO{
		ID:             l.ID,
		Scope:          string(l.Scope),
		TripID:         l.TripID,
		CollectionID:   l.CollectionID,
		AssetID:        l.AssetID,
		Code:           l.Code,
		URL:            prefix + l.Code,
		Note:           l.Note,
		ParentShareID:  l.ParentShareID,
		CreatedByID:    l.CreatedByUserID,
		MaxUses:        l.MaxUses,
		ExpiresAt:      l.ExpiresAt,
		RevokedAt:      l.RevokedAt,
		CreatedAt:      l.CreatedAt,
		DisableForward: l.DisableForward,
	}
}

func realIP(c echo.Context) string {
	if v := c.Request().Header.Get("X-Real-IP"); v != "" {
		return v
	}
	if v := c.Request().Header.Get("X-Forwarded-For"); v != "" {
		// take first
		for i, ch := range v {
			if ch == ',' {
				return v[:i]
			}
		}
		return v
	}
	return c.RealIP()
}
