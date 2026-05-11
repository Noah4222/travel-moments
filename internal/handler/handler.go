package handler

import (
	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/cache"
	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/oss"
	"github.com/cloverstd/travel-moments/internal/settings"
	"github.com/cloverstd/travel-moments/internal/transcoder"
	"github.com/go-webauthn/webauthn/webauthn"
)

// Handler bundles dependencies shared by all HTTP handlers.
type Handler struct {
	DB         *ent.Client
	JWT        *auth.JWT
	ShareJWT   *auth.ShareJWT
	UploadJWT  *auth.UploadJWT
	Cfg        *config.Config
	OSS        oss.Storage
	SignedURLs *cache.SignedURL
	Transcoder transcoder.Transcoder
	Settings   *settings.Store
	WebAuthn   *webauthn.WebAuthn
}

type Deps struct {
	DB         *ent.Client
	JWT        *auth.JWT
	ShareJWT   *auth.ShareJWT
	UploadJWT  *auth.UploadJWT
	Cfg        *config.Config
	OSS        oss.Storage
	SignedURLs *cache.SignedURL
	Transcoder transcoder.Transcoder
	Settings   *settings.Store
	WebAuthn   *webauthn.WebAuthn
}

func New(d Deps) *Handler {
	return &Handler{
		DB: d.DB, JWT: d.JWT, ShareJWT: d.ShareJWT, UploadJWT: d.UploadJWT,
		Cfg: d.Cfg, OSS: d.OSS, SignedURLs: d.SignedURLs,
		Transcoder: d.Transcoder, Settings: d.Settings, WebAuthn: d.WebAuthn,
	}
}
