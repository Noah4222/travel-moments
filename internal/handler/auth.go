package handler

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
)

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResp struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      userDTO   `json:"user"`
}

type userDTO struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Disabled  bool      `json:"disabled"`
	CreatedAt time.Time `json:"created_at"`
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
	// Editor accounts are deprecated — uploads now go through admin-generated
	// one-shot upload links instead.
	if u.Role == user.RoleEditor {
		return echo.NewHTTPError(http.StatusForbidden, "editor accounts can no longer sign in; ask the admin to send you an upload link")
	}
	if !auth.VerifyPassword(u.PasswordHash, req.Password) {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid credentials")
	}
	token, exp, err := h.JWT.Sign(u.ID, string(u.Role))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, loginResp{
		Token:     token,
		ExpiresAt: exp,
		User:      toUserDTO(u),
	})
}

func (h *Handler) Me(c echo.Context) error {
	claims := auth.MustClaims(c)
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not found")
	}
	return c.JSON(http.StatusOK, toUserDTO(u))
}

func toUserDTO(u *ent.User) userDTO {
	return userDTO{
		ID:        u.ID,
		Username:  u.Username,
		Role:      string(u.Role),
		Disabled:  u.Disabled,
		CreatedAt: u.CreatedAt,
	}
}
