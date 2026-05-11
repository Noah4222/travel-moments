package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/ent/assetview"
	"github.com/cloverstd/travel-moments/internal/ent/collection"
	"github.com/cloverstd/travel-moments/internal/ent/collectionasset"
	"github.com/cloverstd/travel-moments/internal/ent/sharelink"
	"github.com/cloverstd/travel-moments/internal/ent/sharetrip"
	"github.com/cloverstd/travel-moments/internal/ent/visit"
	"github.com/cloverstd/travel-moments/internal/oss"
)

// ---- DTOs ----

type publicScopeResp struct {
	Scope     string         `json:"scope"`
	TripID    int            `json:"trip_id,omitempty"`
	Title     string         `json:"title,omitempty"`
	Cover     *string        `json:"cover_url,omitempty"`
	Subtitle  string         `json:"subtitle,omitempty"`
	Assets    []publicAsset  `json:"assets,omitempty"`
	Trips     []publicTrip   `json:"trips,omitempty"`
	ShareNote string         `json:"share_note,omitempty"`
	From      *forwarderInfo `json:"forwarded_from,omitempty"`
}

type publicTrip struct {
	ID          int      `json:"id"`
	Title       string   `json:"title"`
	Location    string   `json:"location,omitempty"`
	Description string   `json:"description,omitempty"`
	CoverURL    *imgURLs `json:"cover_url,omitempty"`
	AssetCount  int      `json:"asset_count"`
}

type publicAsset struct {
	ID          int       `json:"id"`
	Kind        string    `json:"kind"`
	Width       int       `json:"width,omitempty"`
	Height      int       `json:"height,omitempty"`
	Duration    int       `json:"duration_ms,omitempty"`
	HLSStatus   string    `json:"hls_status,omitempty"`
	IsLivePhoto bool      `json:"is_live_photo,omitempty"`
	ViewCount   *int      `json:"view_count,omitempty"`
	URLs        assetURLs `json:"urls"`
}

type forwarderInfo struct {
	ShareCode string `json:"share_code"`
}

type publicURLResp struct {
	URL       string `json:"url"`
	Variant   string `json:"variant"`
	HLSStatus string `json:"hls_status,omitempty"`
}

// ---- handlers ----

func (h *Handler) PublicScope(c echo.Context) error {
	sess := auth.MustShareSession(c)
	ctx := c.Request().Context()
	link, err := h.loadActiveShare(ctx, sess.ShareID)
	if err != nil {
		return err
	}

	if link.Scope == sharelink.ScopeMulti {
		trips, err := h.multiSharedTrips(ctx, link.ID)
		if err != nil {
			return err
		}
		out := publicScopeResp{
			Scope:     string(link.Scope),
			ShareNote: link.Note,
			Trips:     trips,
		}
		return c.JSON(http.StatusOK, out)
	}

	t, err := h.DB.Trip.Get(ctx, link.TripID)
	if err != nil {
		return err
	}
	assets, err := h.scopedAssets(c, link)
	if err != nil {
		return err
	}

	out := publicScopeResp{
		Scope:     string(link.Scope),
		TripID:    t.ID,
		Title:     t.Title,
		Subtitle:  t.Location,
		ShareNote: link.Note,
	}
	out.Assets = make([]publicAsset, len(assets))

	// Per-asset view counts (only when trip toggle is on).
	var counts map[int]int
	if t.ShowViewCounts {
		counts = h.assetViewCounts(c.Request().Context(), assetIDs(assets))
	}

	for i, a := range assets {
		pa := publicAsset{
			ID:          a.ID,
			Kind:        string(a.Kind),
			Width:       a.Width,
			Height:      a.Height,
			Duration:    a.DurationMs,
			HLSStatus:   string(a.HlsStatus),
			IsLivePhoto: a.IsLivePhoto,
			URLs:        h.signAssetURLs(a),
		}
		if counts != nil {
			n := counts[a.ID]
			pa.ViewCount = &n
		}
		out.Assets[i] = pa
	}
	return c.JSON(http.StatusOK, out)
}

// PublicAssetEXIF returns cached EXIF / image-info metadata for an asset that
// the caller's share session is allowed to view.
func (h *Handler) PublicAssetEXIF(c echo.Context) error {
	sess := auth.MustShareSession(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	a, err := h.DB.Asset.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "asset not found")
	}
	link, err := h.loadActiveShare(c.Request().Context(), sess.ShareID)
	if err != nil {
		return err
	}
	if !h.shareCoversTrip(c.Request().Context(), link, a.TripID) {
		return echo.NewHTTPError(http.StatusForbidden, "out of scope")
	}
	a = h.ensureExif(c.Request().Context(), a)
	return c.JSON(http.StatusOK, exifOrEmpty(a.Exif))
}

// PublicTripScope returns one trip's assets, scoped by the visitor's share
// session. Used when the share is "multi" — visitors land on a trip list and
// drill into individual trips.
func (h *Handler) PublicTripScope(c echo.Context) error {
	sess := auth.MustShareSession(c)
	ctx := c.Request().Context()
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	link, err := h.loadActiveShare(ctx, sess.ShareID)
	if err != nil {
		return err
	}
	if !h.shareCoversTrip(ctx, link, id) {
		return echo.NewHTTPError(http.StatusForbidden, "trip not in scope")
	}
	t, err := h.DB.Trip.Get(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "trip not found")
	}
	assets, err := h.DB.Asset.Query().
		Where(asset.TripIDEQ(id)).
		Order(ent.Asc(asset.FieldSortOrder), ent.Asc(asset.FieldID)).
		All(ctx)
	if err != nil {
		return err
	}
	out := publicScopeResp{
		Scope:     "trip",
		TripID:    t.ID,
		Title:     t.Title,
		Subtitle:  t.Location,
		ShareNote: link.Note,
	}
	out.Assets = make([]publicAsset, len(assets))
	var counts map[int]int
	if t.ShowViewCounts {
		counts = h.assetViewCounts(ctx, assetIDs(assets))
	}
	for i, a := range assets {
		pa := publicAsset{
			ID:          a.ID,
			Kind:        string(a.Kind),
			Width:       a.Width,
			Height:      a.Height,
			Duration:    a.DurationMs,
			HLSStatus:   string(a.HlsStatus),
			IsLivePhoto: a.IsLivePhoto,
			URLs:        h.signAssetURLs(a),
		}
		if counts != nil {
			n := counts[a.ID]
			pa.ViewCount = &n
		}
		out.Assets[i] = pa
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) multiSharedTrips(ctx context.Context, shareID int) ([]publicTrip, error) {
	rows, err := h.DB.ShareTrip.Query().
		Where(sharetrip.ShareIDEQ(shareID)).
		Order(ent.Asc(sharetrip.FieldSortOrder), ent.Asc(sharetrip.FieldID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]publicTrip, 0, len(rows))
	for _, r := range rows {
		t, err := h.DB.Trip.Get(ctx, r.TripID)
		if err != nil {
			continue
		}
		count, _ := h.DB.Asset.Query().Where(asset.TripIDEQ(t.ID)).Count(ctx)
		pt := publicTrip{
			ID:          t.ID,
			Title:       t.Title,
			Location:    t.Location,
			Description: t.Description,
			AssetCount:  count,
		}
		if t.CoverAssetID != nil && h.OSS != nil && h.SignedURLs != nil && h.Settings != nil {
			if a, err := h.DB.Asset.Get(ctx, *t.CoverAssetID); err == nil {
				pt.CoverURL = h.signImg(a.ID, a.OssKey, oss.VariantCoverAVIF, oss.VariantCoverWebP, h.Settings.URLTTL())
			}
		}
		out = append(out, pt)
	}
	return out, nil
}

// shareCoversTrip returns true if the share grants access to the given trip,
// considering scope=trip/collection/asset (single trip) and scope=multi (set
// of trips).
func (h *Handler) shareCoversTrip(ctx context.Context, link *ent.ShareLink, tripID int) bool {
	if link.Scope != sharelink.ScopeMulti {
		return link.TripID == tripID
	}
	ok, _ := h.DB.ShareTrip.Query().
		Where(sharetrip.ShareIDEQ(link.ID), sharetrip.TripIDEQ(tripID)).
		Exist(ctx)
	return ok
}

func assetIDs(assets []*ent.Asset) []int {
	ids := make([]int, len(assets))
	for i, a := range assets {
		ids[i] = a.ID
	}
	return ids
}

// PublicAssetURL signs a URL for a specific variant and records an AssetView.
//
//	GET /api/public/assets/:id/url?variant=thumb|preview|original|video
func (h *Handler) PublicAssetURL(c echo.Context) error {
	sess := auth.MustShareSession(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	a, err := h.DB.Asset.Get(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "asset not found")
	}

	link, err := h.loadActiveShare(c.Request().Context(), sess.ShareID)
	if err != nil {
		return err
	}
	if !h.shareCoversTrip(c.Request().Context(), link, a.TripID) {
		return echo.NewHTTPError(http.StatusForbidden, "asset not in shared trip")
	}
	if link.Scope == sharelink.ScopeAsset && link.AssetID != nil && *link.AssetID != a.ID {
		return echo.NewHTTPError(http.StatusForbidden, "asset not in shared link")
	}
	if link.Scope == sharelink.ScopeCollection && link.CollectionID != nil {
		ok, err := h.DB.CollectionAsset.Query().
			Where(collectionasset.CollectionIDEQ(*link.CollectionID),
				collectionasset.AssetIDEQ(a.ID)).
			Exist(c.Request().Context())
		if err != nil {
			return err
		}
		if !ok {
			return echo.NewHTTPError(http.StatusForbidden, "asset not in shared collection")
		}
	}

	variant := c.QueryParam("variant")
	if variant == "" {
		variant = "preview"
	}

	url, kind, err := h.signPublicVariant(a, variant)
	if err != nil {
		return err
	}

	// Record AssetView (best-effort). De-dup per visit+asset so React Strict
	// double-renders, browser tab focus, lightbox prev/next/back etc. don't
	// inflate the counter; each visitor counts at most once per asset.
	go func(visitID, assetID int, k string) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		exists, _ := h.DB.AssetView.Query().
			Where(assetview.VisitIDEQ(visitID), assetview.AssetIDEQ(assetID)).
			Exist(ctx)
		if exists {
			return
		}
		_, _ = h.DB.AssetView.Create().
			SetVisitID(visitID).
			SetAssetID(assetID).
			SetKind(toViewKind(k)).
			SetViewedAt(time.Now()).
			Save(ctx)
	}(sess.VisitID, a.ID, kind)

	return c.JSON(http.StatusOK, publicURLResp{
		URL:       url,
		Variant:   variant,
		HLSStatus: string(a.HlsStatus),
	})
}

// ---- forward (visitor → child share) ----

type forwardReq struct {
	Note           string `json:"note"`
	DisableForward bool   `json:"disable_forward"`
}

type forwardResp struct {
	Code     string `json:"code"`
	Password string `json:"password"`
	URL      string `json:"url"`
}

func (h *Handler) PublicForward(c echo.Context) error {
	sess := auth.MustShareSession(c)
	parent, err := h.loadActiveShare(c.Request().Context(), sess.ShareID)
	if err != nil {
		return err
	}
	if parent.DisableForward {
		return echo.NewHTTPError(http.StatusForbidden, "this share does not allow forwarding")
	}
	var req forwardReq
	_ = c.Bind(&req)

	code := randomToken(8)
	password := randomToken(8)
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	link, err := h.DB.ShareLink.Create().
		SetScope(parent.Scope).
		SetTripID(parent.TripID).
		SetCode(code).
		SetPasswordHash(hash).
		SetParentShareID(parent.ID).
		SetCreatorVisitID(sess.VisitID).
		SetNote(req.Note).
		SetDisableForward(req.DisableForward).
		Save(c.Request().Context())
	if err != nil {
		return err
	}
	if parent.CollectionID != nil {
		_, _ = h.DB.ShareLink.UpdateOneID(link.ID).SetCollectionID(*parent.CollectionID).Save(c.Request().Context())
	}
	return c.JSON(http.StatusCreated, forwardResp{
		Code: link.Code, Password: password, URL: "/s/" + link.Code,
	})
}

// ---- helpers ----

func (h *Handler) loadActiveShare(ctx context.Context, id int) (*ent.ShareLink, error) {
	link, err := h.DB.ShareLink.Get(ctx, id)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, echo.NewHTTPError(http.StatusGone, "share gone")
		}
		return nil, err
	}
	if err := h.assertShareLive(link); err != nil {
		return nil, err
	}
	return link, nil
}

func (h *Handler) assertShareLive(link *ent.ShareLink) error {
	if link.RevokedAt != nil {
		return echo.NewHTTPError(http.StatusGone, "share revoked")
	}
	if link.ExpiresAt != nil && time.Now().After(*link.ExpiresAt) {
		return echo.NewHTTPError(http.StatusGone, "share expired")
	}
	// Walk up the parent chain — if any ancestor is revoked/expired, treat as
	// invalid so cascade revocation is enforced even without the cascade flag.
	cur := link
	for cur.ParentShareID != nil {
		parent, err := h.DB.ShareLink.Get(context.Background(), *cur.ParentShareID)
		if err != nil {
			break
		}
		if parent.RevokedAt != nil {
			return echo.NewHTTPError(http.StatusGone, "parent share revoked")
		}
		cur = parent
	}
	return nil
}

func (h *Handler) signPublicVariant(a *ent.Asset, variant string) (url string, kind string, err error) {
	if h.OSS == nil {
		return "", "", echo.NewHTTPError(http.StatusServiceUnavailable, "OSS not configured")
	}
	switch variant {
	case "thumb":
		if a.Kind == asset.KindVideo {
			return h.signCachedVariant(a.ID, a.OssKey, oss.VariantVideoCoverWebP, h.Settings.URLTTL()), "view", nil
		}
		return h.signCachedVariant(a.ID, a.OssKey, oss.VariantThumbWebP, h.Settings.URLTTL()), "view", nil
	case "preview":
		if a.Kind == asset.KindVideo {
			return h.signCachedVariant(a.ID, a.OssKey, oss.VariantVideoCoverWebP, h.Settings.URLTTL()), "view", nil
		}
		return h.signCachedVariant(a.ID, a.OssKey, oss.VariantPreviewWebP, h.Settings.URLTTL()), "view", nil
	case "original":
		return h.signCachedKey(a.ID, "orig", a.OssKey, "", h.Settings.URLTTL()), "view", nil
	case "download":
		return h.signDownloadCached(a.ID, a.OssKey, basenameFromKey(a.OssKey), h.Settings.URLTTL()), "view", nil
	case "motion":
		if !a.IsLivePhoto || a.MotionKey == "" {
			return "", "", echo.NewHTTPError(http.StatusNotFound, "no live photo motion")
		}
		return h.signCachedKey(a.ID, "motion", a.MotionKey, "", h.Settings.URLTTL()), "view", nil
	case "video":
		// Lazy-trigger transcoding the very first time the asset is viewed.
		if a.HlsStatus == asset.HlsStatusNone && h.Transcoder != nil {
			ctx := context.Background()
			if _, uerr := h.DB.Asset.UpdateOneID(a.ID).
				SetHlsStatus(asset.HlsStatusPending).
				Save(ctx); uerr == nil {
				h.Transcoder.SubmitHLS(ctx, a.ID, a.OssKey)
			}
		}
		// HLS if ready, else original mp4 (browser plays mp4 natively).
		if a.HlsStatus == asset.HlsStatusReady && a.HlsKey != "" {
			return h.signCachedKey(a.ID, "hls", a.HlsKey, "", h.Settings.URLTTL()), "play_start", nil
		}
		return h.signCachedKey(a.ID, "video-orig", a.OssKey, "", h.Settings.URLTTL()), "play_start", nil
	}
	return "", "", echo.NewHTTPError(http.StatusBadRequest, "unknown variant")
}


func toViewKind(s string) assetview.Kind {
	switch s {
	case "play_start":
		return assetview.KindPlayStart
	case "play_complete":
		return assetview.KindPlayComplete
	default:
		return assetview.KindView
	}
}

func (h *Handler) scopedAssets(c echo.Context, link *ent.ShareLink) ([]*ent.Asset, error) {
	if link.Scope == sharelink.ScopeAsset && link.AssetID != nil {
		a, err := h.DB.Asset.Get(c.Request().Context(), *link.AssetID)
		if err != nil {
			return nil, err
		}
		return []*ent.Asset{a}, nil
	}
	q := h.DB.Asset.Query().
		Where(asset.TripIDEQ(link.TripID)).
		Order(ent.Asc(asset.FieldSortOrder), ent.Asc(asset.FieldID))
	if link.Scope == sharelink.ScopeCollection && link.CollectionID != nil {
		q = q.Where(asset.HasCollectionsWith(collection.IDEQ(*link.CollectionID)))
	}
	return q.All(c.Request().Context())
}

func (h *Handler) assetViewCounts(ctx context.Context, ids []int) map[int]int {
	out := make(map[int]int, len(ids))
	if len(ids) == 0 {
		return out
	}
	type row struct {
		AssetID int `json:"asset_id"`
		Count   int `json:"count"`
	}
	var rows []row
	err := h.DB.AssetView.Query().
		Where(assetview.AssetIDIn(ids...)).
		GroupBy(assetview.FieldAssetID).
		Aggregate(ent.Count()).
		Scan(ctx, &rows)
	if err != nil {
		return out
	}
	for _, r := range rows {
		out[r.AssetID] = r.Count
	}
	return out
}

// Used for unused import to keep visit reference.
var _ = visit.IDEQ
var _ = sharelink.IDEQ
