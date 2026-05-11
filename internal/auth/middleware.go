package auth

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

const (
	ctxClaimsKey  = "auth.claims"
	RoleAdmin     = "admin"
	RoleEditor    = "editor"
	headerName    = "Authorization"
	bearerPrefix  = "Bearer "
)

// Middleware extracts JWT from Authorization header. Does NOT enforce login.
func (j *JWT) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			h := c.Request().Header.Get(headerName)
			if strings.HasPrefix(h, bearerPrefix) {
				token := strings.TrimPrefix(h, bearerPrefix)
				if claims, err := j.Parse(token); err == nil {
					c.Set(ctxClaimsKey, claims)
				}
			}
			return next(c)
		}
	}
}

// RequireUser ensures the request has any valid user.
func RequireUser(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if _, ok := c.Get(ctxClaimsKey).(*Claims); !ok {
			return echo.NewHTTPError(http.StatusUnauthorized, "login required")
		}
		return next(c)
	}
}

// RequireRole returns middleware that requires one of the given roles.
func RequireRole(roles ...string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get(ctxClaimsKey).(*Claims)
			if !ok {
				return echo.NewHTTPError(http.StatusUnauthorized, "login required")
			}
			for _, r := range roles {
				if claims.Role == r {
					return next(c)
				}
			}
			return echo.NewHTTPError(http.StatusForbidden, "forbidden")
		}
	}
}

func ClaimsFrom(c echo.Context) (*Claims, bool) {
	v, ok := c.Get(ctxClaimsKey).(*Claims)
	return v, ok
}

func MustClaims(c echo.Context) *Claims {
	v, _ := ClaimsFrom(c)
	return v
}
