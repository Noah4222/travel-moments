package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID int    `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type JWT struct {
	secret    []byte
	expiresIn time.Duration
}

func NewJWT(secret string, expiresIn time.Duration) *JWT {
	return &JWT{secret: []byte(secret), expiresIn: expiresIn}
}

const userSubject = "user"
const challengeSubject = "totp-challenge"

// SignChallenge issues a short-lived token used only as a TOTP challenge
// handle. It must not be accepted as a normal user session — the Parse method
// rejects tokens whose subject != "user".
func (j *JWT) SignChallenge(userID int, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   challengeSubject,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(j.secret)
}

// ParseChallenge validates a TOTP challenge token (must have subject
// "totp-challenge"), returns the user id it points at.
func (j *JWT) ParseChallenge(tokenStr string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return j.secret, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid || c.Subject != challengeSubject {
		return nil, errors.New("invalid challenge token")
	}
	return c, nil
}

func (j *JWT) Sign(userID int, role string) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(j.expiresIn)
	claims := &Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userSubject,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(j.secret)
	return signed, exp, err
}

func (j *JWT) Parse(tokenStr string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return j.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("invalid token")
	}
	// Reject tokens from a different subject family (e.g. upload tokens),
	// which would otherwise validate against the same HMAC secret with an
	// empty UserID and silently impersonate user id 0.
	if claims.Subject != "" && claims.Subject != userSubject {
		return nil, errors.New("not a user token")
	}
	return claims, nil
}
