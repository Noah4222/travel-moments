package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/ent/asset"
)

// MPSCallback receives transcoding completion notifications from 阿里云 MPS.
//
// In production the request must be signed (X-Mps-Signature header verified
// against MPS' public key). Here we expose a minimal endpoint and trust that
// the upstream caller has been authenticated via network restrictions or a
// shared secret. TODO: implement signature verification once MPS integration
// is wired up.
type mpsCallbackBody struct {
	AssetID int    `json:"asset_id"`
	Status  string `json:"status"` // "ready" | "failed"
	HLSKey  string `json:"hls_key"`
	Error   string `json:"error,omitempty"`
}

func (h *Handler) MPSCallback(c echo.Context) error {
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "read body")
	}
	// Signature verification when a shared secret is configured.
	if secret := h.Cfg.OSS.IMSCallbackSecret; secret != "" {
		sig := c.Request().Header.Get("X-Mps-Signature")
		if sig == "" {
			return echo.NewHTTPError(http.StatusForbidden, "missing signature")
		}
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		want := hex.EncodeToString(mac.Sum(nil))
		if !hmac.Equal([]byte(sig), []byte(want)) {
			return echo.NewHTTPError(http.StatusForbidden, "bad signature")
		}
	}
	var b mpsCallbackBody
	if err := c.Bind(&b); err != nil || b.AssetID == 0 || b.Status == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	upd := h.DB.Asset.UpdateOneID(b.AssetID)
	switch b.Status {
	case "ready":
		upd.SetHlsStatus(asset.HlsStatusReady).SetHlsKey(b.HLSKey)
	case "failed":
		upd.SetHlsStatus(asset.HlsStatusFailed)
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "bad status")
	}
	if _, err := upd.Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
