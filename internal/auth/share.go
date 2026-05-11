package auth

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

const (
	shareCookieName = "tm_share"
	ctxShareKey     = "share.session"
	shareSubject    = "share"
)

// ShareSession is the payload stored in the share-session cookie.
type ShareSession struct {
	ShareID int    `json:"sid"`
	VisitID int    `json:"vid"`
	Code    string `json:"c"`
	jwt.RegisteredClaims
}

type ShareJWT struct {
	secret []byte
}

func NewShareJWT(secret string) *ShareJWT {
	return &ShareJWT{secret: []byte(secret)}
}

func (j *ShareJWT) Issue(shareID, visitID int, code string, ttl time.Duration) (string, time.Time, error) {
	exp := time.Now().Add(ttl)
	claims := &ShareSession{
		ShareID: shareID,
		VisitID: visitID,
		Code:    code,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   shareSubject,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(j.secret)
	return signed, exp, err
}

func (j *ShareJWT) Parse(tokenStr string) (*ShareSession, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &ShareSession{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return j.secret, nil
	})
	if err != nil {
		return nil, err
	}
	s, ok := tok.Claims.(*ShareSession)
	if !ok || !tok.Valid || s.Subject != shareSubject {
		return nil, errors.New("invalid share session")
	}
	return s, nil
}

// SetShareCookie writes the cookie on the response.
func SetShareCookie(c echo.Context, value string, exp time.Time, secure bool) {
	c.SetCookie(&http.Cookie{
		Name:     shareCookieName,
		Value:    value,
		Path:     "/",
		Expires:  exp,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearShareCookie deletes the cookie.
func ClearShareCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name:     shareCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// ShareMiddleware extracts share session from cookie if present.
func (j *ShareJWT) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ck, err := c.Cookie(shareCookieName)
			if err == nil && ck.Value != "" {
				if s, err := j.Parse(ck.Value); err == nil {
					c.Set(ctxShareKey, s)
				}
			}
			return next(c)
		}
	}
}

// RequireShareSession enforces a valid share cookie.
func RequireShareSession(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if _, ok := c.Get(ctxShareKey).(*ShareSession); !ok {
			return echo.NewHTTPError(http.StatusUnauthorized, "share session required")
		}
		return next(c)
	}
}

// ShareSessionFrom returns the session if present.
func ShareSessionFrom(c echo.Context) (*ShareSession, bool) {
	v, ok := c.Get(ctxShareKey).(*ShareSession)
	return v, ok
}

// MustShareSession panics on missing session — use after RequireShareSession.
func MustShareSession(c echo.Context) *ShareSession {
	v, _ := ShareSessionFrom(c)
	return v
}
