package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/settings"
)

type settingsResp struct {
	Effective map[string]string `json:"effective"`
	Raw       map[string]string `json:"raw"`
	Defaults  map[string]string `json:"defaults"`
}

var managedKeys = []string{
	settings.KeyURLTTL,
	settings.KeyURLCacheTTL,
	settings.KeyUploadCacheCtl,
	settings.KeyAssetShareTTL,
	settings.KeyImgThumbWebP,
	settings.KeyImgThumbAVIF,
	settings.KeyImgPreviewWebP,
	settings.KeyImgPreviewAVIF,
	settings.KeyImgCoverWebP,
	settings.KeyImgCoverAVIF,
}

func defaultSettings() map[string]string {
	return map[string]string{
		settings.KeyURLTTL:          "10m",
		settings.KeyURLCacheTTL:     "9m",
		settings.KeyUploadCacheCtl:  "public, max-age=31536000, immutable",
		settings.KeyAssetShareTTL:   (7 * 24 * time.Hour).String(),
		settings.KeyImgThumbWebP:    "image/resize,m_lfit,w_480/quality,q_80/format,webp",
		settings.KeyImgThumbAVIF:    "image/resize,m_lfit,w_480/quality,q_70/format,avif",
		settings.KeyImgPreviewWebP:  "image/resize,m_lfit,w_1600/quality,q_85/format,webp",
		settings.KeyImgPreviewAVIF:  "image/resize,m_lfit,w_1600/quality,q_75/format,avif",
		settings.KeyImgCoverWebP:    "image/resize,m_lfit,w_1600/quality,q_90/format,webp",
		settings.KeyImgCoverAVIF:    "image/resize,m_lfit,w_1600/quality,q_80/format,avif",
	}
}

func (h *Handler) AdminGetSettings(c echo.Context) error {
	raw := map[string]string{}
	for _, k := range managedKeys {
		raw[k] = h.Settings.Raw(k)
	}
	return c.JSON(http.StatusOK, settingsResp{
		Effective: h.Settings.All(),
		Raw:       raw,
		Defaults:  defaultSettings(),
	})
}

type updateSettingsReq struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (h *Handler) AdminUpdateSetting(c echo.Context) error {
	var req updateSettingsReq
	if err := c.Bind(&req); err != nil || req.Key == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "key required")
	}
	switch req.Key {
	case settings.KeyURLTTL,
		settings.KeyURLCacheTTL,
		settings.KeyAssetShareTTL:
		if req.Value != "" {
			if _, err := time.ParseDuration(req.Value); err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "value must be a duration like 10m / 24h")
			}
		}
	case settings.KeyUploadConcurrency:
		if req.Value != "" {
			n, err := strconv.Atoi(req.Value)
			if err != nil || n < 1 || n > 32 {
				return echo.NewHTTPError(http.StatusBadRequest, "concurrency must be an integer between 1 and 32")
			}
		}
	case settings.KeyUploadCacheCtl,
		settings.KeyImgThumbWebP, settings.KeyImgThumbAVIF,
		settings.KeyImgPreviewWebP, settings.KeyImgPreviewAVIF,
		settings.KeyImgCoverWebP, settings.KeyImgCoverAVIF:
		// any string allowed
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "unknown key")
	}
	if err := h.Settings.Set(c.Request().Context(), req.Key, req.Value); err != nil {
		return err
	}
	if h.SignedURLs != nil {
		h.SignedURLs.Invalidate("")
	}
	return c.JSON(http.StatusOK, h.Settings.All())
}
