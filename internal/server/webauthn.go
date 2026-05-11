package server

import (
	"net/url"

	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

// newWebAuthn builds a WebAuthn config from cfg.PublicBaseURL.
// If PublicBaseURL is empty, returns nil — passkey endpoints will reject calls
// until the operator configures it.
func newWebAuthn(cfg *config.Config) (*webauthn.WebAuthn, error) {
	if cfg.PublicBaseURL == "" {
		return nil, nil
	}
	u, err := url.Parse(cfg.PublicBaseURL)
	if err != nil {
		return nil, err
	}
	rpID := u.Hostname()
	displayName := cfg.SiteName
	if displayName == "" {
		displayName = "Travel Moments"
	}
	return webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: displayName,
		RPOrigins:     []string{cfg.PublicBaseURL},
	})
}
