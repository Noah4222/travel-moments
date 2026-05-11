package handler

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
	"github.com/pquerna/otp/totp"
)

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// loginResp is returned both on a successful login (Token + User populated)
// and on a TOTP challenge (TOTPRequired + ChallengeToken populated).
type loginResp struct {
	Token          string    `json:"token,omitempty"`
	ExpiresAt      time.Time `json:"expires_at,omitempty"`
	User           *userDTO  `json:"user,omitempty"`
	TOTPRequired   bool      `json:"totp_required,omitempty"`
	ChallengeToken string    `json:"challenge_token,omitempty"`
}

type userDTO struct {
	ID          int       `json:"id"`
	Username    string    `json:"username"`
	Role        string    `json:"role"`
	Disabled    bool      `json:"disabled"`
	TOTPEnabled bool      `json:"totp_enabled"`
	CreatedAt   time.Time `json:"created_at"`
}

func (h *Handler) Login(c echo.Context) error {
	var req loginReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if req.Username == "" || req.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "username and password required")
	}
	u, err := h.DB.User.Query().
		Where(user.UsernameEQ(req.Username)).
		Only(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid credentials")
	}
	if u.Disabled {
		return echo.NewHTTPError(http.StatusForbidden, "account disabled")
	}
	if u.Role == user.RoleEditor {
		return echo.NewHTTPError(http.StatusForbidden, "editor accounts can no longer sign in; ask the admin to send you an upload link")
	}
	if !auth.VerifyPassword(u.PasswordHash, req.Password) {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid credentials")
	}

	// If the user has 2FA on, issue only a short-lived challenge token and
	// require /api/auth/login/totp to exchange it for a real access token.
	if u.TotpEnabled && u.TotpSecret != "" {
		ch, err := h.JWT.SignChallenge(u.ID, 5*time.Minute)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusOK, loginResp{
			TOTPRequired:   true,
			ChallengeToken: ch,
		})
	}

	return c.JSON(http.StatusOK, h.issueSession(u))
}

type loginTOTPReq struct {
	ChallengeToken string `json:"challenge_token"`
	Code           string `json:"code"`
}

// LoginTOTP exchanges a challenge token + valid TOTP code for a session.
func (h *Handler) LoginTOTP(c echo.Context) error {
	var req loginTOTPReq
	if err := c.Bind(&req); err != nil || req.ChallengeToken == "" || req.Code == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "challenge_token and code required")
	}
	cl, err := h.JWT.ParseChallenge(req.ChallengeToken)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid or expired challenge")
	}
	u, err := h.DB.User.Get(c.Request().Context(), cl.UserID)
	if err != nil || u.Disabled || !u.TotpEnabled || u.TotpSecret == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "challenge no longer valid")
	}
	if !totp.Validate(req.Code, u.TotpSecret) {
		return echo.NewHTTPError(http.StatusUnauthorized, "wrong code")
	}
	return c.JSON(http.StatusOK, h.issueSession(u))
}

func (h *Handler) issueSession(u *ent.User) loginResp {
	token, exp, err := h.JWT.Sign(u.ID, string(u.Role))
	if err != nil {
		return loginResp{}
	}
	dto := toUserDTO(u)
	return loginResp{Token: token, ExpiresAt: exp, User: &dto}
}

func (h *Handler) Me(c echo.Context) error {
	claims := auth.MustClaims(c)
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not found")
	}
	dto := toUserDTO(u)
	return c.JSON(http.StatusOK, dto)
}

// ---- change password (own) ----

type changePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handler) ChangePassword(c echo.Context) error {
	var req changePasswordReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if len(req.NewPassword) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "new password must be at least 8 chars")
	}
	claims := auth.MustClaims(c)
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return err
	}
	if !auth.VerifyPassword(u.PasswordHash, req.CurrentPassword) {
		return echo.NewHTTPError(http.StatusUnauthorized, "current password incorrect")
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	if _, err := h.DB.User.UpdateOneID(u.ID).SetPasswordHash(hash).Save(c.Request().Context()); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func toUserDTO(u *ent.User) userDTO {
	return userDTO{
		ID:          u.ID,
		Username:    u.Username,
		Role:        string(u.Role),
		Disabled:    u.Disabled,
		TOTPEnabled: u.TotpEnabled,
		CreatedAt:   u.CreatedAt,
	}
}
