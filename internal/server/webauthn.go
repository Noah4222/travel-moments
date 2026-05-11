package server

import (
	"net/url"
	"strings"

	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

// newWebAuthn builds a WebAuthn config from cfg.PublicBaseURL.
// If PublicBaseURL is empty, returns nil — passkey endpoints will reject calls
// until the operator configures it.
//
// Extra origins can be added via cfg.WebAuthnExtraOrigins (comma-separated
// list, e.g. "https://staging.example.com,https://alt.example.com"). All must
// share the same registrable host as PUBLIC_BASE_URL (or be sub-domains of
// the RP ID).
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
	origins := []string{strings.TrimRight(cfg.PublicBaseURL, "/")}
	for _, o := range strings.Split(cfg.WebAuthnExtraOrigins, ",") {
		o = strings.TrimSpace(strings.TrimRight(o, "/"))
		if o != "" {
			origins = append(origins, o)
		}
	}
	return webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: displayName,
		RPOrigins:     origins,
	})
}
