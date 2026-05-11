package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
)

type createUserReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type updateUserReq struct {
	Password *string `json:"password,omitempty"`
	Role     *string `json:"role,omitempty"`
	Disabled *bool   `json:"disabled,omitempty"`
}

func (h *Handler) ListUsers(c echo.Context) error {
	users, err := h.DB.User.Query().Order(ent.Asc(user.FieldID)).All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]userDTO, len(users))
	for i, u := range users {
		out[i] = toUserDTO(u)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateUser(c echo.Context) error {
	var req createUserReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if req.Username == "" || req.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "username and password required")
	}
	role, err := parseRole(req.Role)
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return err
	}
	created, err := h.DB.User.Create().
		SetUsername(req.Username).
		SetPasswordHash(hash).
		SetRole(role).
		Save(c.Request().Context())
	if err != nil {
		if ent.IsConstraintError(err) {
			return echo.NewHTTPError(http.StatusConflict, "username already exists")
		}
		return err
	}
	return c.JSON(http.StatusCreated, toUserDTO(created))
}

func (h *Handler) UpdateUser(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	var req updateUserReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	upd := h.DB.User.UpdateOneID(id)
	if req.Password != nil && *req.Password != "" {
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			return err
		}
		upd = upd.SetPasswordHash(hash)
	}
	if req.Role != nil {
		role, err := parseRole(*req.Role)
		if err != nil {
			return err
		}
		upd = upd.SetRole(role)
	}
	if req.Disabled != nil {
		upd = upd.SetDisabled(*req.Disabled)
	}
	u, err := upd.Save(c.Request().Context())
	if err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return err
	}
	return c.JSON(http.StatusOK, toUserDTO(u))
}

func (h *Handler) DeleteUser(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	claims := auth.MustClaims(c)
	if claims.UserID == id {
		return echo.NewHTTPError(http.StatusBadRequest, "cannot delete yourself")
	}
	if err := h.DB.User.DeleteOneID(id).Exec(c.Request().Context()); err != nil {
		if ent.IsNotFound(err) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func parseRole(s string) (user.Role, error) {
	switch s {
	case string(user.RoleAdmin):
		return user.RoleAdmin, nil
	case string(user.RoleEditor):
		return user.RoleEditor, nil
	default:
		return "", echo.NewHTTPError(http.StatusBadRequest, "role must be admin or editor")
	}
}
