package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pquerna/otp/totp"

	"github.com/cloverstd/travel-moments/internal/auth"
)

type totpSetupResp struct {
	Secret string `json:"secret"`
	URI    string `json:"otpauth_uri"`
}

// SetupTOTP generates a fresh shared secret + otpauth:// URI for the
// currently logged-in user and stores the secret in pending form (totp_secret
// set, totp_enabled still false). The client renders a QR for the URI and
// then POSTs a verification code to /enable to flip the flag on.
//
// Calling /setup again before enabling overwrites the pending secret —
// useful if the user lost their authenticator app mid-setup.
func (h *Handler) SetupTOTP(c echo.Context) error {
	claims := auth.MustClaims(c)
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return err
	}
	if u.TotpEnabled {
		return echo.NewHTTPError(http.StatusConflict, "TOTP already enabled; disable first")
	}
	issuer := h.Cfg.SiteName
	if issuer == "" {
		issuer = "Travel Moments"
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: u.Username,
	})
	if err != nil {
		return err
	}
	if _, err := h.DB.User.UpdateOneID(u.ID).
		SetTotpSecret(key.Secret()).
		Save(c.Request().Context()); err != nil {
		return err
	}
	return c.JSON(http.StatusOK, totpSetupResp{
		Secret: key.Secret(),
		URI:    key.URL(),
	})
}

type totpEnableReq struct {
	Code string `json:"code"`
}

// EnableTOTP verifies that the user can produce a valid code from the secret
// returned by /setup, then flips totp_enabled on.
func (h *Handler) EnableTOTP(c echo.Context) error {
	claims := auth.MustClaims(c)
	var req totpEnableReq
	if err := c.Bind(&req); err != nil || req.Code == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "code required")
	}
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return err
	}
	if u.TotpEnabled {
		return echo.NewHTTPError(http.StatusConflict, "TOTP already enabled")
	}
	if u.TotpSecret == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "no pending TOTP setup; call /setup first")
	}
	if !totp.Validate(req.Code, u.TotpSecret) {
		return echo.NewHTTPError(http.StatusUnauthorized, "wrong code")
	}
	if _, err := h.DB.User.UpdateOneID(u.ID).
		SetTotpEnabled(true).
		Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type totpDisableReq struct {
	Password string `json:"password"`
}

// DisableTOTP turns the second factor off; requires the account password to
// avoid drive-by disabling from a stolen session.
func (h *Handler) DisableTOTP(c echo.Context) error {
	claims := auth.MustClaims(c)
	var req totpDisableReq
	if err := c.Bind(&req); err != nil || req.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "password required")
	}
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return err
	}
	if !auth.VerifyPassword(u.PasswordHash, req.Password) {
		return echo.NewHTTPError(http.StatusUnauthorized, "wrong password")
	}
	if _, err := h.DB.User.UpdateOneID(u.ID).
		SetTotpEnabled(false).
		ClearTotpSecret().
		Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
