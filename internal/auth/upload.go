package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

const (
	uploadSubject = "upload"
	ctxUploadKey  = "upload.claims"
)

// UploadClaims is what a one-shot upload grant gets after consume.
type UploadClaims struct {
	TripID  int `json:"tid"`
	GrantID int `json:"gid"`
	jwt.RegisteredClaims
}

type UploadJWT struct {
	secret []byte
}

func NewUploadJWT(secret string) *UploadJWT {
	return &UploadJWT{secret: []byte(secret)}
}

// Issue returns a JWT scoped to a single trip, valid for ttl.
func (j *UploadJWT) Issue(tripID, grantID int, ttl time.Duration) (string, time.Time, error) {
	exp := time.Now().Add(ttl)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, &UploadClaims{
		TripID:  tripID,
		GrantID: grantID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   uploadSubject,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	signed, err := tok.SignedString(j.secret)
	return signed, exp, err
}

func (j *UploadJWT) Parse(tokenStr string) (*UploadClaims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &UploadClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return j.secret, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*UploadClaims)
	if !ok || !tok.Valid || c.Subject != uploadSubject {
		return nil, errors.New("invalid upload token")
	}
	return c, nil
}

// Middleware decodes the Authorization Bearer (if present) as either a user
// JWT or upload JWT; resulting claims land in echo context.
func (j *UploadJWT) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tok := bearerToken(c)
			if tok != "" {
				if cl, err := j.Parse(tok); err == nil {
					c.Set(ctxUploadKey, cl)
				}
			}
			return next(c)
		}
	}
}

func bearerToken(c echo.Context) string {
	h := c.Request().Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return ""
	}
	return strings.TrimPrefix(h, p)
}

// RequireUploadOrUser allows either a logged-in user (any role) OR a valid
// upload JWT to pass. On success the handler may read either UserClaims or
// UploadClaims from context.
func RequireUploadOrUser(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if _, ok := c.Get(ctxClaimsKey).(*Claims); ok {
			return next(c)
		}
		if _, ok := c.Get(ctxUploadKey).(*UploadClaims); ok {
			return next(c)
		}
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}
}

// UploadClaimsFrom returns the upload claims if present.
func UploadClaimsFrom(c echo.Context) (*UploadClaims, bool) {
	v, ok := c.Get(ctxUploadKey).(*UploadClaims)
	return v, ok
}
