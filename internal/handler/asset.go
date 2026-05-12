package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/ent/assetview"
	"github.com/cloverstd/travel-moments/internal/ent/collectionasset"
	"github.com/cloverstd/travel-moments/internal/ent/comment"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/oss"
)

// ---- DTOs ----

type imgURLs struct {
	AVIF string `json:"avif,omitempty"`
	WebP string `json:"webp,omitempty"`
}

type assetURLs struct {
	Thumb      *imgURLs `json:"thumb,omitempty"`
	Preview    *imgURLs `json:"preview,omitempty"`
	VideoCover *imgURLs `json:"video_cover,omitempty"`
	Video      string   `json:"video,omitempty"`
	Motion     string   `json:"motion,omitempty"`
	Original   string   `json:"original,omitempty"`
	Download   string   `json:"download,omitempty"`
}

type assetDTO struct {
	ID          int        `json:"id"`
	TripID      int        `json:"trip_id"`
	Kind        string     `json:"kind"`
	Mime        string     `json:"mime"`
	Size        int64      `json:"size"`
	Width       int        `json:"width,omitempty"`
	Height      int        `json:"height,omitempty"`
	DurationMs  int        `json:"duration_ms,omitempty"`
	TakenAt     *time.Time `json:"taken_at,omitempty"`
	HLSStatus   string     `json:"hls_status"`
	SortOrder   int        `json:"sort_order"`
	UploadedBy  int        `json:"uploaded_by_id"`
	IsLivePhoto bool       `json:"is_live_photo,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	URLs        assetURLs  `json:"urls"`
}

// ---- Upload policy ----

type policyReq struct {
	TripID   int    `json:"trip_id"`
	Filename string `json:"filename"`
	Mime     string `json:"mime"`
	Kind     string `json:"kind"` // "photo" | "video"
}

type policyResp struct {
	*oss.UploadPolicy
	OSSKey string `json:"oss_key"`
}

func (h *Handler) UploadPolicy(c echo.Context) error {
	if h.OSS == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "OSS not configured")
	}
	var req policyReq
	if err := c.Bind(&req); err != nil || req.TripID == 0 || req.Filename == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "trip_id and filename required")
	}
	if err := h.ensureTripWriteAccess(c, req.TripID); err != nil {
		return err
	}

	ext := strings.ToLower(path.Ext(req.Filename))
	if ext == "" {
		ext = guessExt(req.Mime)
	}
	kind := req.Kind
	if kind == "" {
		kind = guessKind(req.Mime)
	}
	subdir := "raw"
	if kind == "video" {
		subdir = "raw/video"
	}
	key := fmt.Sprintf("trips/%d/%s/%s%s", req.TripID, subdir, uuid.NewString(), ext)

	policy, err := h.OSS.SignUploadPolicy(key, 0, 30*time.Minute)
	if err != nil {
		return err
	}
	if h.Settings != nil {
		policy.CacheControl = h.Settings.UploadCacheControl()
	}
	return c.JSON(http.StatusOK, policyResp{UploadPolicy: policy, OSSKey: key})
}

// ---- Upload complete ----

type completeReq struct {
	TripID       int        `json:"trip_id"`
	OSSKey       string     `json:"oss_key"`
	Kind         string     `json:"kind"`
	Mime         string     `json:"mime"`
	Size         int64      `json:"size"`
	Width        int        `json:"width"`
	Height       int        `json:"height"`
	DurationMs   int        `json:"duration_ms"`
	TakenAt      *time.Time `json:"taken_at"`
	IsLivePhoto  bool       `json:"is_live_photo"`
	MotionOSSKey string     `json:"motion_oss_key"`
	MotionMime   string     `json:"motion_mime"`
}

func (h *Handler) UploadComplete(c echo.Context) error {
	var req completeReq
	if err := c.Bind(&req); err != nil || req.TripID == 0 || req.OSSKey == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "trip_id and oss_key required")
	}
	if err := h.ensureTripWriteAccess(c, req.TripID); err != nil {
		return err
	}
	uploaderID, err := h.resolveUploaderID(c)
	if err != nil {
		return err
	}
	// Defense: oss_key must belong to this trip path.
	if !strings.HasPrefix(req.OSSKey, fmt.Sprintf("trips/%d/", req.TripID)) {
		return echo.NewHTTPError(http.StatusBadRequest, "oss_key does not belong to this trip")
	}
	kind := asset.KindPhoto
	if req.Kind == "video" || strings.HasPrefix(req.Mime, "video/") {
		kind = asset.KindVideo
	}

	// Sort order = current max + 1.
	maxOrder, _ := h.DB.Asset.Query().
		Where(asset.TripIDEQ(req.TripID)).
		Aggregate(ent.Max(asset.FieldSortOrder)).
		Int(c.Request().Context())

	cr := h.DB.Asset.Create().
		SetTripID(req.TripID).
		SetUploadedByID(uploaderID).
		SetKind(kind).
		SetOssKey(req.OSSKey).
		SetMime(req.Mime).
		SetSize(req.Size).
		SetSortOrder(maxOrder + 1)
	if req.Width > 0 {
		cr = cr.SetWidth(req.Width)
	}
	if req.Height > 0 {
		cr = cr.SetHeight(req.Height)
	}
	if req.DurationMs > 0 {
		cr = cr.SetDurationMs(req.DurationMs)
	}
	if req.TakenAt != nil {
		cr = cr.SetTakenAt(*req.TakenAt)
	}
	if kind == asset.KindVideo {
		cr = cr.SetHlsStatus(asset.HlsStatusPending)
	}
	if req.IsLivePhoto && req.MotionOSSKey != "" {
		if !strings.HasPrefix(req.MotionOSSKey, fmt.Sprintf("trips/%d/", req.TripID)) {
			return echo.NewHTTPError(http.StatusBadRequest, "motion_oss_key not in this trip")
		}
		cr = cr.SetIsLivePhoto(true).SetMotionKey(req.MotionOSSKey)
		if req.MotionMime != "" {
			cr = cr.SetMotionMime(req.MotionMime)
		}
	}

	a, err := cr.Save(c.Request().Context())
	if err != nil {
		return err
	}

	// Best-effort: capture EXIF / image-info via OSS image processing.
	if kind == asset.KindPhoto && h.OSS != nil {
		go h.captureExif(a.ID, a.OssKey)
	}

	return c.JSON(http.StatusCreated, h.toAssetDTO(a))
}

func (h *Handler) captureExif(assetID int, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	info, err := h.fetchImageInfo(key)
	if err != nil || len(info) == 0 {
		return
	}
	if _, err := h.DB.Asset.UpdateOneID(assetID).SetExif(info).Save(ctx); err != nil {
		slog.Default().Warn("save exif failed", "asset_id", assetID, "err", err)
	}
}

func (h *Handler) fetchImageInfo(key string) (map[string]any, error) {
	url, err := h.OSS.SignDownload(key, "image/info", 2*time.Minute)
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequest("GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("image/info HTTP %d", resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// ---- List assets in a trip ----

// assetPage is the cursor-paginated response envelope. cursor = the id of the
// last item from the previous page; the next query takes id < cursor. total
// is the count for the whole trip and is only populated on the first page
// (cursor == 0) so the frontend can render "N 张".
type assetPage struct {
	Assets     []assetDTO `json:"assets"`
	NextCursor *int       `json:"next_cursor"`
	Total      *int       `json:"total,omitempty"`
}

const (
	defaultAssetPageSize = 100
	maxAssetPageSize     = 200
)

func parseAssetPagination(c echo.Context) (cursor, limit int) {
	limit = defaultAssetPageSize
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			if n < 1 {
				n = 1
			} else if n > maxAssetPageSize {
				n = maxAssetPageSize
			}
			limit = n
		}
	}
	if v := c.QueryParam("cursor"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cursor = n
		}
	}
	return
}

func (h *Handler) ListAssets(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	cursor, limit := parseAssetPagination(c)
	page, err := h.pagedTripAssets(c.Request().Context(), id, cursor, limit)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

// ListAssetIDs returns every asset id in a trip (no signing, no pagination).
// Used by the admin "全选" action so selection can span uploaded-but-not-yet-
// rendered pages without forcing the full DTO build.
func (h *Handler) ListAssetIDs(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripAccess(c, id); err != nil {
		return err
	}
	ids, err := h.DB.Asset.Query().
		Where(asset.TripIDEQ(id)).
		Order(ent.Desc(asset.FieldID)).
		IDs(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ids)
}

// pagedTripAssets builds an assetPage for a trip, descending by id. cursor=0
// means first page (the total is computed in that case).
func (h *Handler) pagedTripAssets(ctx context.Context, tripID, cursor, limit int) (assetPage, error) {
	q := h.DB.Asset.Query().Where(asset.TripIDEQ(tripID))
	if cursor > 0 {
		q = q.Where(asset.IDLT(cursor))
	}
	rows, err := q.Order(ent.Desc(asset.FieldID)).Limit(limit).All(ctx)
	if err != nil {
		return assetPage{}, err
	}
	out := make([]assetDTO, len(rows))
	for i, a := range rows {
		out[i] = h.toAssetDTO(a)
	}
	page := assetPage{Assets: out}
	if len(rows) == limit {
		next := rows[len(rows)-1].ID
		page.NextCursor = &next
	}
	if cursor == 0 {
		total, err := h.DB.Asset.Query().Where(asset.TripIDEQ(tripID)).Count(ctx)
		if err != nil {
			return assetPage{}, err
		}
		page.Total = &total
	}
	return page, nil
}

// resolveUploaderID picks the user_id to attribute new assets to: the logged-in
// user when a session is present, else the admin who created the upload grant.
func (h *Handler) resolveUploaderID(c echo.Context) (int, error) {
	if cl, ok := auth.ClaimsFrom(c); ok && cl.UserID > 0 {
		return cl.UserID, nil
	}
	if uc, ok := auth.UploadClaimsFrom(c); ok {
		g, err := h.DB.UploadGrant.Get(c.Request().Context(), uc.GrantID)
		if err != nil {
			return 0, echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("grant lookup failed: %v", err))
		}
		if g.CreatedByUserID == 0 {
			return 0, echo.NewHTTPError(http.StatusInternalServerError, "grant has no creator")
		}
		return g.CreatedByUserID, nil
	}
	return 0, echo.NewHTTPError(http.StatusUnauthorized, "no identity")
}

// ensureTripWriteAccess allows admin / authorized editor users OR a valid
// upload-grant JWT scoped to the same trip.
func (h *Handler) ensureTripWriteAccess(c echo.Context, id int) error {
	if uc, ok := auth.UploadClaimsFrom(c); ok {
		if uc.TripID != id {
			return echo.NewHTTPError(http.StatusForbidden, "upload token does not match trip")
		}
		return nil
	}
	return h.ensureTripAccess(c, id)
}

// ---- Admin URL signer (no view counting) ----
//
//	GET /api/assets/:id/url?variant=preview|full_webp|full_avif|original|video|motion
//
// Mirrors the public variant set but for logged-in users with trip access;
// crucially does NOT write an AssetView row.
func (h *Handler) AdminAssetURL(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	a, err := h.DB.Asset.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "asset not found")
	}
	if err := h.ensureTripAccess(c, a.TripID); err != nil {
		return err
	}
	variant := c.QueryParam("variant")
	if variant == "" {
		variant = "preview"
	}
	url, _, err := h.signPublicVariant(a, variant)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{
		"url":        url,
		"variant":    variant,
		"hls_status": string(a.HlsStatus),
	})
}

// ---- Admin EXIF (admin/editor with trip access) ----

func (h *Handler) AdminAssetEXIF(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	a, err := h.DB.Asset.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "asset not found")
	}
	if err := h.ensureTripAccess(c, a.TripID); err != nil {
		return err
	}
	a = h.ensureExif(c.Request().Context(), a)
	return c.JSON(http.StatusOK, exifOrEmpty(a.Exif))
}

// ensureExif fills in a.Exif inline when missing — covers assets uploaded
// before the EXIF capture goroutine landed, or when that goroutine crashed.
func (h *Handler) ensureExif(ctx context.Context, a *ent.Asset) *ent.Asset {
	if a == nil || a.Kind != asset.KindPhoto || h.OSS == nil || len(a.Exif) > 0 {
		return a
	}
	info, err := h.fetchImageInfo(a.OssKey)
	if err != nil || len(info) == 0 {
		return a
	}
	updated, err := h.DB.Asset.UpdateOneID(a.ID).SetExif(info).Save(ctx)
	if err != nil {
		return a
	}
	return updated
}

func exifOrEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// ---- Delete asset ----

func (h *Handler) DeleteAsset(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	ctx := c.Request().Context()
	a, err := h.DB.Asset.Get(ctx, id)
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "asset not found")
		}
		return err
	}

	// DB cleanup in a single transaction so FK constraints can't leave us
	// in a half-deleted state (asset gone from OSS but row still in DB).
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

	if _, err := tx.AssetView.Delete().
		Where(assetview.AssetIDEQ(id)).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.CollectionAsset.Delete().
		Where(collectionasset.AssetIDEQ(id)).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.Comment.Delete().
		Where(comment.AssetIDEQ(id)).
		Exec(ctx); err != nil {
		return err
	}
	// Revoke any single-asset shares pointing at this asset and clear the FK.
	if _, err := tx.ShareLink.Update().
		Where(sharelink.AssetIDEQ(id)).
		ClearAssetID().
		SetRevokedAt(time.Now()).
		Save(ctx); err != nil {
		return err
	}

	if err := tx.Asset.DeleteOneID(id).Exec(ctx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true

	// OSS cleanup — only after DB commit succeeded. Best-effort: a leaked
	// OSS object is far less harmful than a dangling DB row.
	if h.OSS != nil {
		_ = h.OSS.DeleteObject(a.OssKey)
		if a.HlsKey != "" {
			_ = h.OSS.DeleteObject(a.HlsKey)
		}
		if a.ThumbKey != "" {
			_ = h.OSS.DeleteObject(a.ThumbKey)
		}
		if a.MotionKey != "" {
			_ = h.OSS.DeleteObject(a.MotionKey)
		}
	}
	if h.SignedURLs != nil {
		h.SignedURLs.Invalidate(fmt.Sprintf("a:%d:", id))
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- Sort ----

type sortReq struct {
	OrderedAssetIDs []int `json:"ordered_asset_ids"`
}

func (h *Handler) ReorderAssets(c echo.Context) error {
	id, err := tripID(c)
	if err != nil {
		return err
	}
	if err := h.ensureTripWriteAccess(c, id); err != nil {
		return err
	}
	var req sortReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	ctx := c.Request().Context()
	tx, err := h.DB.Tx(ctx)
	if err != nil {
		return err
	}
	for i, aid := range req.OrderedAssetIDs {
		if _, err := tx.Asset.UpdateOneID(aid).
			Where(asset.TripIDEQ(id)).
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

// ---- helpers ----

func (h *Handler) toAssetDTO(a *ent.Asset) assetDTO {
	d := assetDTO{
		ID:          a.ID,
		TripID:      a.TripID,
		Kind:        string(a.Kind),
		Mime:        a.Mime,
		Size:        a.Size,
		Width:       a.Width,
		Height:      a.Height,
		DurationMs:  a.DurationMs,
		TakenAt:     a.TakenAt,
		HLSStatus:   string(a.HlsStatus),
		SortOrder:   a.SortOrder,
		UploadedBy:  a.UploadedByID,
		IsLivePhoto: a.IsLivePhoto,
		CreatedAt:   a.CreatedAt,
	}
	d.URLs = h.signAssetURLs(a)
	return d
}

func (h *Handler) signAssetURLs(a *ent.Asset) assetURLs {
	if h.OSS == nil || h.SignedURLs == nil {
		return assetURLs{}
	}
	ttl := h.Settings.URLTTL()
	urls := assetURLs{}
	switch a.Kind {
	case asset.KindPhoto:
		urls.Thumb = h.signImg(a.ID, a.OssKey, oss.VariantThumbAVIF, oss.VariantThumbWebP, ttl)
		urls.Preview = h.signImg(a.ID, a.OssKey, oss.VariantPreviewAVIF, oss.VariantPreviewWebP, ttl)
	case asset.KindVideo:
		urls.VideoCover = h.signImg(a.ID, a.OssKey, oss.VariantVideoCoverAVIF, oss.VariantVideoCoverWebP, ttl)
		if a.HlsStatus == asset.HlsStatusReady && a.HlsKey != "" {
			urls.Video = h.signCachedKey(a.ID, "hls", a.HlsKey, "", ttl)
		} else {
			urls.Video = h.signCachedKey(a.ID, "video-orig", a.OssKey, "", ttl)
		}
	}
	if a.IsLivePhoto && a.MotionKey != "" {
		urls.Motion = h.signCachedKey(a.ID, "motion", a.MotionKey, "", ttl)
	}
	urls.Download = h.signDownloadCached(a.ID, a.OssKey, basenameFromKey(a.OssKey), ttl)
	return urls
}

func (h *Handler) signImg(assetID int, key string, avif, webp oss.Variant, ttl time.Duration) *imgURLs {
	return &imgURLs{
		AVIF: h.signCachedVariant(assetID, key, avif, ttl),
		WebP: h.signCachedVariant(assetID, key, webp, ttl),
	}
}

func (h *Handler) signCachedVariant(assetID int, key string, v oss.Variant, ttl time.Duration) string {
	return h.signCachedKey(assetID, string(v), key, h.Settings.ImageProcess(v), ttl)
}

func (h *Handler) signCachedKey(assetID int, variantTag, key, process string, ttl time.Duration) string {
	cacheKey := fmt.Sprintf("a:%d:%s", assetID, variantTag)
	url, err := h.SignedURLs.GetOrSet(cacheKey, func() (string, error) {
		return h.OSS.SignDownload(key, process, ttl)
	})
	if err != nil {
		return ""
	}
	return url
}

func (h *Handler) signDownloadCached(assetID int, key, filename string, ttl time.Duration) string {
	cacheKey := fmt.Sprintf("a:%d:dl", assetID)
	url, err := h.SignedURLs.GetOrSet(cacheKey, func() (string, error) {
		return h.OSS.SignDownloadAttachment(key, "", filename, ttl)
	})
	if err != nil {
		return ""
	}
	return url
}

func basenameFromKey(key string) string {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == '/' {
			return key[i+1:]
		}
	}
	return key
}

func guessExt(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/heic":
		return ".heic"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	}
	return ""
}

func guessKind(mime string) string {
	if strings.HasPrefix(mime, "video/") {
		return "video"
	}
	return "photo"
}
