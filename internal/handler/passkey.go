package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
	"github.com/cloverstd/travel-moments/internal/ent/usercredential"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// ---- WebAuthn user adapter ----

type waUser struct {
	user *ent.User
	creds []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return idToBytes(u.user.ID) }
func (u *waUser) WebAuthnName() string                       { return u.user.Username }
func (u *waUser) WebAuthnDisplayName() string                { return u.user.Username }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func idToBytes(id int) []byte {
	b := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		b[i] = byte(id)
		id >>= 8
	}
	return b
}

func bytesToID(b []byte) int {
	id := 0
	for _, x := range b {
		id = id<<8 | int(x)
	}
	return id
}

func (h *Handler) loadWAUser(c echo.Context, u *ent.User) (*waUser, error) {
	rows, err := h.DB.UserCredential.Query().
		Where(usercredential.UserIDEQ(u.ID)).
		All(c.Request().Context())
	if err != nil {
		return nil, err
	}
	creds := make([]webauthn.Credential, len(rows))
	for i, r := range rows {
		creds[i] = entToCred(r)
	}
	return &waUser{user: u, creds: creds}, nil
}

func entToCred(c *ent.UserCredential) webauthn.Credential {
	var transports []protocol.AuthenticatorTransport
	if c.Transports != "" {
		for _, s := range strings.Split(c.Transports, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				transports = append(transports, protocol.AuthenticatorTransport(s))
			}
		}
	}
	return webauthn.Credential{
		ID:              c.CredentialID,
		PublicKey:       c.PublicKey,
		AttestationType: c.AttestationType,
		Transport:       transports,
		Authenticator: webauthn.Authenticator{
			AAGUID:    c.Aaguid,
			SignCount: c.SignCount,
		},
		Flags: webauthn.CredentialFlags{
			BackupEligible: c.BackupEligible,
			BackupState:    c.BackupState,
		},
	}
}

// ---- in-memory session store (challenge persistence between start/finish) ----

type passkeySession struct {
	UserID int
	Data   webauthn.SessionData
	Expiry time.Time
}

type passkeyStore struct {
	mu sync.Mutex
	m  map[string]passkeySession
}

var passkeyStoreInst = &passkeyStore{m: make(map[string]passkeySession)}

func (s *passkeyStore) put(id string, sess passkeySession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	s.m[id] = sess
}

func (s *passkeyStore) take(id string) (passkeySession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	if !ok {
		return passkeySession{}, false
	}
	delete(s.m, id)
	if time.Now().After(v.Expiry) {
		return passkeySession{}, false
	}
	return v, true
}

func (s *passkeyStore) cleanupLocked() {
	now := time.Now()
	for k, v := range s.m {
		if now.After(v.Expiry) {
			delete(s.m, k)
		}
	}
}

const passkeyCookie = "tm_passkey_session"

func setPasskeyCookie(c echo.Context, id string, secure bool) {
	c.SetCookie(&http.Cookie{
		Name:     passkeyCookie,
		Value:    id,
		Path:     "/",
		Expires:  time.Now().Add(5 * time.Minute),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearPasskeyCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{Name: passkeyCookie, Value: "", Path: "/", MaxAge: -1})
}

// ---- DTOs ----

type credentialDTO struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

// ---- list / delete (logged-in user) ----

func (h *Handler) ListMyPasskeys(c echo.Context) error {
	claims := auth.MustClaims(c)
	rows, err := h.DB.UserCredential.Query().
		Where(usercredential.UserIDEQ(claims.UserID)).
		Order(ent.Desc(usercredential.FieldCreatedAt)).
		All(c.Request().Context())
	if err != nil {
		return err
	}
	out := make([]credentialDTO, len(rows))
	for i, r := range rows {
		out[i] = credentialDTO{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt}
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) DeleteMyPasskey(c echo.Context) error {
	claims := auth.MustClaims(c)
	id := atoiOrZero(c.Param("id"))
	if id == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad id")
	}
	n, err := h.DB.UserCredential.Delete().
		Where(usercredential.IDEQ(id), usercredential.UserIDEQ(claims.UserID)).
		Exec(c.Request().Context())
	if err != nil {
		return err
	}
	if n == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return c.NoContent(http.StatusNoContent)
}

// ---- register start / finish (logged-in user adds a new passkey) ----

type registerStartReq struct {
	Name string `json:"name"`
}

func (h *Handler) PasskeyRegisterStart(c echo.Context) error {
	if h.WebAuthn == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "passkey not configured; set PUBLIC_BASE_URL")
	}
	claims := auth.MustClaims(c)
	u, err := h.DB.User.Get(c.Request().Context(), claims.UserID)
	if err != nil {
		return err
	}
	wu, err := h.loadWAUser(c, u)
	if err != nil {
		return err
	}
	options, sessionData, err := h.WebAuthn.BeginRegistration(wu)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	var name string
	var req registerStartReq
	_ = c.Bind(&req)
	name = req.Name

	id := uuid.NewString()
	passkeyStoreInst.put(id, passkeySession{
		UserID: u.ID,
		Data:   *sessionData,
		Expiry: time.Now().Add(5 * time.Minute),
	})
	setPasskeyCookie(c, id+"|"+name, h.Cfg.SecureCookies)
	return c.JSON(http.StatusOK, options)
}

func (h *Handler) PasskeyRegisterFinish(c echo.Context) error {
	if h.WebAuthn == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "passkey not configured")
	}
	cookie, err := c.Cookie(passkeyCookie)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "missing passkey session")
	}
	sessionID, name, _ := strings.Cut(cookie.Value, "|")
	sess, ok := passkeyStoreInst.take(sessionID)
	if !ok {
		return echo.NewHTTPError(http.StatusBadRequest, "passkey session expired")
	}
	clearPasskeyCookie(c)
	u, err := h.DB.User.Get(c.Request().Context(), sess.UserID)
	if err != nil {
		return err
	}
	wu, err := h.loadWAUser(c, u)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialCreationResponse(c.Request())
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	cred, err := h.WebAuthn.CreateCredential(wu, sess.Data, parsed)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	transports := make([]string, 0, len(cred.Transport))
	for _, t := range cred.Transport {
		transports = append(transports, string(t))
	}
	_, err = h.DB.UserCredential.Create().
		SetUserID(u.ID).
		SetName(name).
		SetCredentialID(cred.ID).
		SetPublicKey(cred.PublicKey).
		SetAttestationType(cred.AttestationType).
		SetAaguid(cred.Authenticator.AAGUID).
		SetSignCount(cred.Authenticator.SignCount).
		SetTransports(strings.Join(transports, ",")).
		SetBackupEligible(cred.Flags.BackupEligible).
		SetBackupState(cred.Flags.BackupState).
		Save(c.Request().Context())
	if err != nil {
		return err
	}
	return c.NoContent(http.StatusCreated)
}

// ---- login start / finish (no auth) ----

type loginStartReq struct {
	Username string `json:"username"`
}

func (h *Handler) PasskeyLoginStart(c echo.Context) error {
	if h.WebAuthn == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "passkey not configured")
	}
	var req loginStartReq
	_ = c.Bind(&req)

	var options *protocol.CredentialAssertion
	var sessionData *webauthn.SessionData
	var err error
	userID := 0
	if req.Username != "" {
		u, e := h.DB.User.Query().Where(user.UsernameEQ(req.Username)).Only(c.Request().Context())
		if e != nil {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		wu, e := h.loadWAUser(c, u)
		if e != nil {
			return e
		}
		options, sessionData, err = h.WebAuthn.BeginLogin(wu)
		userID = u.ID
	} else {
		options, sessionData, err = h.WebAuthn.BeginDiscoverableLogin()
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	id := uuid.NewString()
	passkeyStoreInst.put(id, passkeySession{
		UserID: userID,
		Data:   *sessionData,
		Expiry: time.Now().Add(5 * time.Minute),
	})
	setPasskeyCookie(c, id, h.Cfg.SecureCookies)
	return c.JSON(http.StatusOK, options)
}

func (h *Handler) PasskeyLoginFinish(c echo.Context) error {
	if h.WebAuthn == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "passkey not configured")
	}
	cookie, err := c.Cookie(passkeyCookie)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "missing passkey session")
	}
	sess, ok := passkeyStoreInst.take(cookie.Value)
	if !ok {
		return echo.NewHTTPError(http.StatusBadRequest, "passkey session expired")
	}
	clearPasskeyCookie(c)
	parsed, err := protocol.ParseCredentialRequestResponse(c.Request())
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	var cred *webauthn.Credential
	var u *ent.User
	if sess.UserID > 0 {
		u, err = h.DB.User.Get(c.Request().Context(), sess.UserID)
		if err != nil {
			return err
		}
		wu, err := h.loadWAUser(c, u)
		if err != nil {
			return err
		}
		cred, err = h.WebAuthn.ValidateLogin(wu, sess.Data, parsed)
		if err != nil {
			return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
		}
	} else {
		cred, err = h.WebAuthn.ValidateDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
			uid := bytesToID(userHandle)
			uu, err := h.DB.User.Get(c.Request().Context(), uid)
			if err != nil {
				return nil, err
			}
			u = uu
			return h.loadWAUser(c, uu)
		}, sess.Data, parsed)
		if err != nil {
			return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
		}
	}
	if u == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not resolved")
	}
	if u.Disabled || u.Role == user.RoleEditor {
		return echo.NewHTTPError(http.StatusForbidden, "account cannot sign in")
	}

	// Update stored credential's sign count.
	if cred != nil {
		_, _ = h.DB.UserCredential.Update().
			Where(usercredential.CredentialIDEQ(cred.ID)).
			SetSignCount(cred.Authenticator.SignCount).
			SetBackupState(cred.Flags.BackupState).
			SetLastUsedAt(time.Now()).
			Save(c.Request().Context())
	}

	tok, exp, err := h.JWT.Sign(u.ID, string(u.Role))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{
		"token":      tok,
		"expires_at": exp,
		"user":       toUserDTO(u),
	})
}

// ---- misc ----

func atoiOrZero(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// Ensure encoding/json reference doesn't drift.
var _ = base64.StdEncoding
var _ = json.Marshal
var _ = errors.New
