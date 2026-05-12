package handler

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/trip"
	"github.com/cloverstd/travel-moments/internal/ent/uploadgrant"
)

// ---- DTOs ----

type uploadGrantDTO struct {
	ID         int        `json:"id"`
	TripID     int        `json:"trip_id"`
	TripTitle  string     `json:"trip_title,omitempty"`
	Code       string     `json:"code"`
	URL        string     `json:"url"`
	Note       string     `json:"note,omitempty"`
	CreatedByID int       `json:"created_by_user_id"`
	ExpiresAt  time.Time  `json:"expires_at"`
	ConsumedAt *time.Time `json:"consumed_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type createUploadGrantReq struct {
	Note      string     `json:"note"`
	ExpiresAt *time.Time `json:"expires_at"`
	HoursTTL  int        `json:"hours_ttl"` // alternative to expires_at
}

type createUploadGrantResp struct {
	uploadGrantDTO
	Token string `json:"token"` // returned once
}

// ---- admin endpoints ----

// CreateUploadGrant — admin generates a one-shot upload link for a trip.
func (h *Handler) CreateUploadGrant(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if _, err := h.DB.Trip.Get(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "trip not found")
	}
	var req createUploadGrantReq
	_ = c.Bind(&req)
	claims := auth.MustClaims(c)

	exp := req.ExpiresAt
	if exp == nil {
		hours := req.HoursTTL
		if hours <= 0 {
			hours = 24
		}
		t := time.Now().Add(time.Duration(hours) * time.Hour)
		exp = &t
	}

	token := randomURLToken(32)
	hash, err := auth.HashPassword(token)
	if err != nil {
		return err
	}
	code := randomToken(10)

	g, err := h.DB.UploadGrant.Create().
		SetCode(code).
		SetTokenHash(hash).
		SetTripID(id).
		SetCreatedByUserID(claims.UserID).
		SetNote(req.Note).
		SetExpiresAt(*exp).
		Save(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, createUploadGrantResp{
		uploadGrantDTO: toUploadGrantDTO(g, ""),
		Token:          token,
	})
}

// ListUploadGrants — admin lists grants for a trip.
func (h *Handler) ListUploadGrants(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	gs, err := h.DB.UploadGrant.Query().
		Where(uploadgrant.TripIDEQ(id)).
		Order(ent.Desc(uploadgrant.FieldCreatedAt)).
		All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]uploadGrantDTO, len(gs))
	for i, g := range gs {
		out[i] = toUploadGrantDTO(g, "")
	}
	return c.JSON(http.StatusOK, out)
}

// RevokeUploadGrant — admin revokes a grant.
func (h *Handler) RevokeUploadGrant(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	if _, err := h.DB.UploadGrant.UpdateOneID(id).
		SetRevokedAt(time.Now()).
		Save(c.Request().Context()); err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "grant not found")
		}
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- public endpoints ----

type uploadGrantInfoResp struct {
	TripID    int    `json:"trip_id"`
	TripTitle string `json:"trip_title"`
	Status    string `json:"status"` // ready | consumed | expired | revoked
}

func (h *Handler) UploadGrantInfo(c echo.Context) error {
	g, err := h.DB.UploadGrant.Query().
		Where(uploadgrant.CodeEQ(c.Param("code"))).
		Only(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	t, err := h.DB.Trip.Query().Where(trip.IDEQ(g.TripID)).Only(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "trip gone")
	}
	return c.JSON(http.StatusOK, uploadGrantInfoResp{
		TripID:    g.TripID,
		TripTitle: t.Title,
		Status:    grantStatus(g),
	})
}

type consumeUploadGrantReq struct {
	Token string `json:"token"`
}

type consumeUploadGrantResp struct {
	UploadToken string    `json:"upload_token"`
	ExpiresAt   time.Time `json:"expires_at"`
	TripID      int       `json:"trip_id"`
	TripTitle   string    `json:"trip_title"`
}

// ConsumeUploadGrant — marks the grant used and returns a short-lived upload
// JWT. The plain `token` from the URL #hash is bcrypt-compared.
func (h *Handler) ConsumeUploadGrant(c echo.Context) error {
	var req consumeUploadGrantReq
	if err := c.Bind(&req); err != nil || req.Token == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "token required")
	}
	g, err := h.DB.UploadGrant.Query().
		Where(uploadgrant.CodeEQ(c.Param("code"))).
		Only(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	switch grantStatus(g) {
	case "consumed":
		return echo.NewHTTPError(http.StatusGone, "link already used")
	case "expired":
		return echo.NewHTTPError(http.StatusGone, "link expired")
	case "revoked":
		return echo.NewHTTPError(http.StatusGone, "link revoked")
	}
	if !auth.VerifyPassword(g.TokenHash, req.Token) {
		return echo.NewHTTPError(http.StatusUnauthorized, "wrong token")
	}

	now := time.Now()
	_, err = h.DB.UploadGrant.UpdateOneID(g.ID).
		SetConsumedAt(now).
		SetConsumedIP(realIP(c)).
		SetConsumedUa(c.Request().UserAgent()).
		Save(c.Request().Context())
	if err != nil {
		return err
	}

	// Upload session lives until the grant itself expires — admin sets the
	// link TTL when generating it, no separate system-wide knob.
	ttl := time.Until(g.ExpiresAt)
	if ttl < time.Minute {
		return echo.NewHTTPError(http.StatusGone, "link expires too soon")
	}
	tok, exp, err := h.UploadJWT.Issue(g.TripID, g.ID, ttl)
	if err != nil {
		return err
	}
	t, _ := h.DB.Trip.Get(c.Request().Context(), g.TripID)
	title := ""
	if t != nil {
		title = t.Title
	}
	return c.JSON(http.StatusOK, consumeUploadGrantResp{
		UploadToken: tok,
		ExpiresAt:   exp,
		TripID:      g.TripID,
		TripTitle:   title,
	})
}

// RequireActiveUploadOrUser is a middleware that combines auth.RequireUploadOrUser
// with a DB check: when the request carries an upload-grant JWT, verify the
// underlying grant has not been revoked. This makes admin "立即失效" actually
// kick in-flight upload sessions out, not just block future consumes.
func (h *Handler) RequireActiveUploadOrUser(next echo.HandlerFunc) echo.HandlerFunc {
	return auth.RequireUploadOrUser(func(c echo.Context) error {
		if uc, ok := auth.UploadClaimsFrom(c); ok {
			g, err := h.DB.UploadGrant.Get(c.Request().Context(), uc.GrantID)
			if err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "upload grant gone")
			}
			if g.RevokedAt != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "upload link revoked")
			}
			if time.Now().After(g.ExpiresAt) {
				return echo.NewHTTPError(http.StatusUnauthorized, "upload link expired")
			}
		}
		return next(c)
	})
}

// ---- helpers ----

func grantStatus(g *ent.UploadGrant) string {
	if g.RevokedAt != nil {
		return "revoked"
	}
	if g.ConsumedAt != nil {
		return "consumed"
	}
	if time.Now().After(g.ExpiresAt) {
		return "expired"
	}
	return "ready"
}

func toUploadGrantDTO(g *ent.UploadGrant, tripTitle string) uploadGrantDTO {
	return uploadGrantDTO{
		ID:          g.ID,
		TripID:      g.TripID,
		TripTitle:   tripTitle,
		Code:        g.Code,
		URL:         "/upload/" + g.Code,
		Note:        g.Note,
		CreatedByID: g.CreatedByUserID,
		ExpiresAt:   g.ExpiresAt,
		ConsumedAt:  g.ConsumedAt,
		RevokedAt:   g.RevokedAt,
		CreatedAt:   g.CreatedAt,
	}
}

func randomURLToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
