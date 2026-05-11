package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/ent/collection"
	"github.com/cloverstd/travel-moments/internal/ent/collectionasset"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
)

// ---- DTOs ----

type collectionDTO struct {
	ID          int       `json:"id"`
	TripID      int       `json:"trip_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	AssetCount  int       `json:"asset_count"`
	AssetIDs    []int     `json:"asset_ids,omitempty"`
	CreatedByID int       `json:"created_by_id"`
	CreatedAt   time.Time `json:"created_at"`
}

type createCollectionReq struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	AssetIDs    []int  `json:"asset_ids"`
}

type updateCollectionReq struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
}

type assetIDsReq struct {
	AssetIDs []int `json:"asset_ids"`
}

// ---- Trip-scoped: list / create ----

func (h *Handler) ListCollections(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	cols, err := h.DB.Collection.Query().
		Where(collection.TripIDEQ(id)).
		Order(ent.Desc(collection.FieldCreatedAt)).
		All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]collectionDTO, len(cols))
	for i, col := range cols {
		count, _ := h.DB.CollectionAsset.Query().
			Where(collectionasset.CollectionIDEQ(col.ID)).
			Count(c.Request().Context())
		out[i] = collectionDTO{
			ID:          col.ID,
			TripID:      col.TripID,
			Title:       col.Title,
			Description: col.Description,
			AssetCount:  count,
			CreatedByID: col.CreatedByID,
			CreatedAt:   col.CreatedAt,
		}
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateCollection(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripWriteAccess(c, id); err != nil {
		return err
	}
	var req createCollectionReq
	if err := c.Bind(&req); err != nil || req.Title == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "title required")
	}
	claims := auth.MustClaims(c)

	ctx := c.Request().Context()
	tx, err := h.DB.Tx(ctx)
	if err != nil {
		return err
	}
	col, err := tx.Collection.Create().
		SetTripID(id).
		SetCreatedByID(claims.UserID).
		SetTitle(req.Title).
		SetDescription(req.Description).
		Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	// Validate all asset IDs belong to this trip, then add them.
	if len(req.AssetIDs) > 0 {
		ok, err := tx.Asset.Query().
			Where(asset.IDIn(req.AssetIDs...), asset.TripIDEQ(id)).
			Count(ctx)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if ok != len(req.AssetIDs) {
			_ = tx.Rollback()
			return echo.NewHTTPError(http.StatusBadRequest, "some assets do not belong to this trip")
		}
		for i, aid := range req.AssetIDs {
			if _, err := tx.CollectionAsset.Create().
				SetCollectionID(col.ID).
				SetAssetID(aid).
				SetSortOrder(i + 1).
				Save(ctx); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, collectionDTO{
		ID:          col.ID,
		TripID:      col.TripID,
		Title:       col.Title,
		Description: col.Description,
		AssetCount:  len(req.AssetIDs),
		AssetIDs:    req.AssetIDs,
		CreatedByID: col.CreatedByID,
		CreatedAt:   col.CreatedAt,
	})
}

// ---- Single collection ----

func (h *Handler) GetCollection(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripAccess(c, col.TripID); err != nil {
		return err
	}
	ids, err := h.collectionAssetIDs(c, col.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, collectionDTO{
		ID:          col.ID,
		TripID:      col.TripID,
		Title:       col.Title,
		Description: col.Description,
		AssetCount:  len(ids),
		AssetIDs:    ids,
		CreatedByID: col.CreatedByID,
		CreatedAt:   col.CreatedAt,
	})
}

func (h *Handler) UpdateCollection(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripWriteAccess(c, col.TripID); err != nil {
		return err
	}
	var req updateCollectionReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	upd := h.DB.Collection.UpdateOneID(id)
	if req.Title != nil {
		upd = upd.SetTitle(*req.Title)
	}
	if req.Description != nil {
		upd = upd.SetDescription(*req.Description)
	}
	if _, err := upd.Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) DeleteCollection(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripWriteAccess(c, col.TripID); err != nil {
		return err
	}
	if err := h.DB.Collection.DeleteOneID(id).Exec(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- Replace member assets ----

func (h *Handler) SetCollectionAssets(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripWriteAccess(c, col.TripID); err != nil {
		return err
	}
	var req assetIDsReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	ctx := c.Request().Context()
	if len(req.AssetIDs) > 0 {
		valid, err := h.DB.Asset.Query().
			Where(asset.IDIn(req.AssetIDs...), asset.TripIDEQ(col.TripID)).
			Count(ctx)
		if err != nil {
			return err
		}
		if valid != len(req.AssetIDs) {
			return echo.NewHTTPError(http.StatusBadRequest, "some assets do not belong to this trip")
		}
	}
	tx, err := h.DB.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.CollectionAsset.Delete().
		Where(collectionasset.CollectionIDEQ(id)).
		Exec(ctx); err != nil {
		_ = tx.Rollback()
		return err
	}
	for i, aid := range req.AssetIDs {
		if _, err := tx.CollectionAsset.Create().
			SetCollectionID(id).
			SetAssetID(aid).
			SetSortOrder(i + 1).
			Save(ctx); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- Collection-level shares ----

func (h *Handler) CreateCollectionShare(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripWriteAccess(c, col.TripID); err != nil {
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
		SetScope(sharelink.ScopeCollection).
		SetTripID(col.TripID).
		SetCollectionID(col.ID).
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
	return c.JSON(http.StatusCreated, createShareResp{shareDTO: toShareDTO(link), Password: password})
}

func (h *Handler) ListCollectionShares(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	col, err := h.DB.Collection.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "collection not found")
	}
	if err := h.ensureTripAccess(c, col.TripID); err != nil {
		return err
	}
	claims := auth.MustClaims(c)
	q := h.DB.ShareLink.Query().
		Where(sharelink.CollectionIDEQ(id)).
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

// ---- helpers ----

func (h *Handler) collectionAssetIDs(c echo.Context, collectionID int) ([]int, error) {
	rows, err := h.DB.CollectionAsset.Query().
		Where(collectionasset.CollectionIDEQ(collectionID)).
		Order(ent.Asc(collectionasset.FieldSortOrder), ent.Asc(collectionasset.FieldAssetID)).
		All(c.Request().Context())
	if err != nil {
		return nil, err
	}
	ids := make([]int, len(rows))
	for i, r := range rows {
		ids[i] = r.AssetID
	}
	return ids, nil
}
