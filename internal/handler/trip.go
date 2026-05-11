package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/trip"
	"github.com/cloverstd/travel-moments/internal/ent/tripeditor"
	"github.com/cloverstd/travel-moments/internal/ent/user"
	"github.com/cloverstd/travel-moments/internal/oss"
)

type tripDTO struct {
	ID             int        `json:"id"`
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	Location       string     `json:"location"`
	StartedAt      *time.Time `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at"`
	CoverAssetID   *int       `json:"cover_asset_id"`
	CoverURL       *imgURLs   `json:"cover_url,omitempty"`
	ShowViewCounts bool       `json:"show_view_counts"`
	CreatedByID    int        `json:"created_by_id"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	EditorUserIDs  []int      `json:"editor_user_ids,omitempty"`
}

type tripCreateReq struct {
	Slug        string     `json:"slug"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Location    string     `json:"location"`
	StartedAt   *time.Time `json:"started_at"`
	EndedAt     *time.Time `json:"ended_at"`
}

type tripUpdateReq struct {
	Title          *string    `json:"title,omitempty"`
	Description    *string    `json:"description,omitempty"`
	Location       *string    `json:"location,omitempty"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
	CoverAssetID   *int       `json:"cover_asset_id,omitempty"`
	ShowViewCounts *bool      `json:"show_view_counts,omitempty"`
}

func (h *Handler) ListTrips(c echo.Context) error {
	claims := auth.MustClaims(c)
	q := h.DB.Trip.Query().
		WithEditors(func(uq *ent.UserQuery) { uq.Select(user.FieldID) }).
		Order(func(s *sql.Selector) {
			// Newest-first by the user-set started_at; fall back to
			// created_at so trips without a date don't get stuck on top.
			s.OrderBy("COALESCE(" + s.C(trip.FieldStartedAt) + ", " +
				s.C(trip.FieldCreatedAt) + ") DESC")
		}, ent.Desc(trip.FieldID))
	if claims.Role == auth.RoleEditor {
		q = q.Where(trip.HasEditorsWith(user.IDEQ(claims.UserID)))
	}
	trips, err := q.All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]tripDTO, len(trips))
	for i, t := range trips {
		out[i] = h.toTripDTO(t)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) GetTrip(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	t, err := h.DB.Trip.Query().
		Where(trip.IDEQ(id)).
		WithEditors(func(uq *ent.UserQuery) { uq.Select(user.FieldID) }).
		Only(c.Request().Context())
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "trip not found")
		}
		return err
	}
	return c.JSON(http.StatusOK, h.toTripDTO(t))
}

func (h *Handler) CreateTrip(c echo.Context) error {
	claims := auth.MustClaims(c)
	var req tripCreateReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if req.Slug == "" || req.Title == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "slug and title required")
	}
	cr := h.DB.Trip.Create().
		SetSlug(req.Slug).
		SetTitle(req.Title).
		SetDescription(req.Description).
		SetLocation(req.Location).
		SetCreatedByID(claims.UserID)
	if req.StartedAt != nil {
		cr = cr.SetStartedAt(*req.StartedAt)
	}
	if req.EndedAt != nil {
		cr = cr.SetEndedAt(*req.EndedAt)
	}
	t, err := cr.Save(c.Request().Context())
	if err != nil {
		if ent.IsConstraintError(err) {
			return echo.NewHTTPError(http.StatusConflict, "slug already exists")
		}
		return err
	}
	return c.JSON(http.StatusCreated, h.toTripDTO(t))
}

func (h *Handler) UpdateTrip(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	var req tripUpdateReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	upd := h.DB.Trip.UpdateOneID(id)
	if req.Title != nil {
		upd = upd.SetTitle(*req.Title)
	}
	if req.Description != nil {
		upd = upd.SetDescription(*req.Description)
	}
	if req.Location != nil {
		upd = upd.SetLocation(*req.Location)
	}
	if req.StartedAt != nil {
		upd = upd.SetStartedAt(*req.StartedAt)
	}
	if req.EndedAt != nil {
		upd = upd.SetEndedAt(*req.EndedAt)
	}
	if req.CoverAssetID != nil {
		upd = upd.SetCoverAssetID(*req.CoverAssetID)
	}
	if req.ShowViewCounts != nil {
		upd = upd.SetShowViewCounts(*req.ShowViewCounts)
	}
	t, err := upd.Save(c.Request().Context())
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "trip not found")
		}
		return err
	}
	return c.JSON(http.StatusOK, h.toTripDTO(t))
}

func (h *Handler) DeleteTrip(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.DB.Trip.DeleteOneID(id).Exec(c.Request().Context()); err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "trip not found")
		}
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type editorReq struct {
	UserID int `json:"user_id"`
}

func (h *Handler) AddEditor(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	var req editorReq
	if err := c.Bind(&req); err != nil || req.UserID == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	u, err := h.DB.User.Get(c.Request().Context(), req.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}
	if u.Role != user.RoleEditor {
		return echo.NewHTTPError(http.StatusBadRequest, "user is not an editor")
	}
	_, err = h.DB.TripEditor.Create().
		SetTripID(id).
		SetUserID(req.UserID).
		Save(c.Request().Context())
	if err != nil && !ent.IsConstraintError(err) {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) RemoveEditor(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	uid, err := strconv.Atoi(c.Param("user_id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad user_id")
	}
	_, err = h.DB.TripEditor.Delete().
		Where(tripeditor.TripIDEQ(id), tripeditor.UserIDEQ(uid)).
		Exec(c.Request().Context())
	if err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ensureTripAccess: admin can access any trip; editor only assigned ones.
func (h *Handler) ensureTripAccess(c echo.Context, tripID int) error {
	claims := auth.MustClaims(c)
	if claims.Role == auth.RoleAdmin {
		return nil
	}
	ok, err := h.DB.TripEditor.Query().
		Where(tripeditor.TripIDEQ(tripID), tripeditor.UserIDEQ(claims.UserID)).
		Exist(c.Request().Context())
	if err != nil {
		return err
	}
	if !ok {
		return echo.NewHTTPError(http.StatusForbidden, "no access to this trip")
	}
	return nil
}

func tripID(c echo.Context) (int, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	return id, nil
}

func (h *Handler) toTripDTO(t *ent.Trip) tripDTO {
	d := tripDTO{
		ID:             t.ID,
		Slug:           t.Slug,
		Title:          t.Title,
		Description:    t.Description,
		Location:       t.Location,
		StartedAt:      t.StartedAt,
		EndedAt:        t.EndedAt,
		CoverAssetID:   t.CoverAssetID,
		ShowViewCounts: t.ShowViewCounts,
		CreatedByID:    t.CreatedByID,
		CreatedAt:      t.CreatedAt,
		UpdatedAt:      t.UpdatedAt,
	}
	if t.CoverAssetID != nil && h.OSS != nil && h.SignedURLs != nil && h.Settings != nil {
		// Best-effort lookup; ignore errors so listing isn't blocked.
		a, err := h.DB.Asset.Get(context.Background(), *t.CoverAssetID)
		if err == nil {
			d.CoverURL = h.signImg(a.ID, a.OssKey, oss.VariantCoverAVIF, oss.VariantCoverWebP, h.Settings.URLTTL())
		}
	}
	if eds, err := t.Edges.EditorsOrErr(); err == nil {
		ids := make([]int, len(eds))
		for i, u := range eds {
			ids[i] = u.ID
		}
		d.EditorUserIDs = ids
	}
	return d
}
