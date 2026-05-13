package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/cache"
	"github.com/cloverstd/travel-moments/internal/config"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/frontend"
	"github.com/cloverstd/travel-moments/internal/ent/asset"
	"github.com/cloverstd/travel-moments/internal/handler"
	"github.com/cloverstd/travel-moments/internal/oss"
	"github.com/cloverstd/travel-moments/internal/settings"
	"github.com/cloverstd/travel-moments/internal/transcoder"
)

func New(cfg *config.Config, client *ent.Client, logger *slog.Logger) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())
	e.Use(middleware.RequestID())
	e.Use(middleware.Gzip())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogMethod:    true,
		LogURI:       true,
		LogStatus:    true,
		LogLatency:   true,
		LogRemoteIP:  true,
		LogRequestID: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			logger.Info("http",
				"id", v.RequestID,
				"method", v.Method,
				"uri", v.URI,
				"status", v.Status,
				"ip", v.RemoteIP,
				"latency_ms", v.Latency.Milliseconds(),
			)
			return nil
		},
	}))

	jwt := auth.NewJWT(cfg.JWTSecret, cfg.JWTExpiresIn)
	shareJWT := auth.NewShareJWT(cfg.JWTSecret)
	uploadJWT := auth.NewUploadJWT(cfg.JWTSecret)
	ossStorage, err := oss.New(cfg.OSS)
	if err != nil {
		logger.Error("oss init failed", "err", err)
	} else {
		logger.Info("oss backend ready", "backend", ossStorage.Backend())
	}
	urlCache := cache.NewSignedURL(2048, cfg.SignedURLCacheTTL)

	st := settings.New(client, cfg)
	if err := st.Load(context.Background()); err != nil {
		logger.Error("settings load failed", "err", err)
	}

	wa, err := newWebAuthn(cfg)
	if err != nil {
		logger.Error("webauthn init failed", "err", err)
	}

	tc := newTranscoder(cfg, client, logger)
	h := handler.New(handler.Deps{
		DB: client, JWT: jwt, ShareJWT: shareJWT, UploadJWT: uploadJWT,
		Cfg: cfg, OSS: ossStorage, SignedURLs: urlCache,
		Transcoder: tc, Settings: st, WebAuthn: wa,
	})

	api := e.Group("/api")
	api.Use(jwt.Middleware())
	api.Use(shareJWT.Middleware())
	api.Use(uploadJWT.Middleware())

	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
	})

	// Auth
	api.POST("/auth/login", h.Login)
	api.POST("/auth/login/totp", h.LoginTOTP)
	api.GET("/auth/me", h.Me, auth.RequireUser)
	api.POST("/auth/password", h.ChangePassword, auth.RequireUser)
	api.POST("/auth/totp/setup", h.SetupTOTP, auth.RequireUser)
	api.POST("/auth/totp/enable", h.EnableTOTP, auth.RequireUser)
	api.POST("/auth/totp/disable", h.DisableTOTP, auth.RequireUser)

	// Passkeys (WebAuthn)
	api.GET("/passkeys", h.ListMyPasskeys, auth.RequireUser)
	api.DELETE("/passkeys/:id", h.DeleteMyPasskey, auth.RequireUser)
	api.POST("/passkeys/register/start", h.PasskeyRegisterStart, auth.RequireUser)
	api.POST("/passkeys/register/finish", h.PasskeyRegisterFinish, auth.RequireUser)
	api.POST("/passkeys/login/start", h.PasskeyLoginStart)
	api.POST("/passkeys/login/finish", h.PasskeyLoginFinish)

	// User management (admin)
	users := api.Group("/users", auth.RequireRole(auth.RoleAdmin))
	users.GET("", h.ListUsers)
	users.POST("", h.CreateUser)
	users.PATCH("/:id", h.UpdateUser)
	users.DELETE("/:id", h.DeleteUser)

	// Trips: list/get accessible to any logged-in user (admin or assigned editor)
	trips := api.Group("/trips", auth.RequireUser)
	trips.GET("", h.ListTrips)
	trips.GET("/:id", h.GetTrip)
	trips.GET("/:id/assets", h.ListAssets)
	trips.GET("/:id/asset-ids", h.ListAssetIDs)
	trips.POST("/:id/assets/reorder", h.ReorderAssets)
	// Mutations admin-only
	tripsAdmin := api.Group("/trips", auth.RequireRole(auth.RoleAdmin))
	tripsAdmin.POST("", h.CreateTrip)
	tripsAdmin.PATCH("/:id", h.UpdateTrip)
	tripsAdmin.DELETE("/:id", h.DeleteTrip)
	tripsAdmin.POST("/:id/editors", h.AddEditor)
	tripsAdmin.DELETE("/:id/editors/:user_id", h.RemoveEditor)

	// Upload: any logged-in user with access to that trip
	api.GET("/upload-limits", h.PublicUploadLimits)
	api.GET("/assets/:id/url", h.AdminAssetURL, auth.RequireUser)
	api.POST("/upload/policy", h.UploadPolicy, h.RequireActiveUploadOrUser)
	api.POST("/upload/complete", h.UploadComplete, h.RequireActiveUploadOrUser)

	// Upload grants (one-shot upload links for non-account contributors)
	trips.POST("/:id/upload-grants", h.CreateUploadGrant)
	trips.GET("/:id/upload-grants", h.ListUploadGrants)
	api.DELETE("/upload-grants/:id", h.RevokeUploadGrant, auth.RequireUser)
	api.GET("/upload-grants/:code/info", h.UploadGrantInfo)
	api.POST("/upload-grants/:code/consume", h.ConsumeUploadGrant)

	// Assets: delete is admin-only
	api.DELETE("/assets/:id", h.DeleteAsset, auth.RequireRole(auth.RoleAdmin))
	api.POST("/assets/:id/edit", h.EditAsset, auth.RequireRole(auth.RoleAdmin))
	api.GET("/assets/:id/exif", h.AdminAssetEXIF, auth.RequireUser)

	// Collections (admin/editor)
	trips.GET("/:id/collections", h.ListCollections)
	trips.POST("/:id/collections", h.CreateCollection)
	api.GET("/collections/:id", h.GetCollection, auth.RequireUser)
	api.PATCH("/collections/:id", h.UpdateCollection, auth.RequireUser)
	api.DELETE("/collections/:id", h.DeleteCollection, auth.RequireUser)
	api.POST("/collections/:id/assets", h.SetCollectionAssets, auth.RequireUser)
	api.GET("/collections/:id/shares", h.ListCollectionShares, auth.RequireUser)
	api.POST("/collections/:id/shares", h.CreateCollectionShare, auth.RequireUser)

	// Share management (admin/editor)
	trips.GET("/:id/shares", h.ListTripShares)
	trips.POST("/:id/shares", h.CreateTripShare)
	api.POST("/shares/:id/revoke", h.RevokeShare, auth.RequireUser)
	api.GET("/shares/:id/stats", h.ShareStats, auth.RequireRole(auth.RoleAdmin))
	api.GET("/shares/:id/tree", h.ShareTree, auth.RequireRole(auth.RoleAdmin))

	// Public (no JWT, but may carry share-session cookie)
	api.GET("/public/shares/:code/info", h.ShareInfo)
	api.POST("/public/shares/:code/auth", h.AuthShare)
	api.POST("/public/logout", h.Logout)
	api.POST("/assets/:id/share", h.CreateAssetShare, auth.RequireUser)
	api.POST("/shares/multi", h.CreateMultiShare, auth.RequireUser)
	pub := api.Group("/public", auth.RequireShareSession)
	pub.GET("/scope", h.PublicScope)
	pub.GET("/trips/:id", h.PublicTripScope)
	pub.GET("/assets", h.PublicListAssets)
	pub.GET("/assets/:id/url", h.PublicAssetURL)
	pub.GET("/assets/:id/exif", h.PublicAssetEXIF)
	pub.POST("/forward", h.PublicForward)
	pub.GET("/comments", h.PublicListComments)
	pub.POST("/comments", h.PublicPostComment)

	// Admin settings
	adminSet := api.Group("/admin/settings", auth.RequireRole(auth.RoleAdmin))
	adminSet.GET("", h.AdminGetSettings)
	adminSet.PATCH("", h.AdminUpdateSetting)

	// Admin comment management
	adminCmt := api.Group("/admin/comments", auth.RequireRole(auth.RoleAdmin))
	adminCmt.GET("", h.AdminListComments)
	adminCmt.PATCH("/:id", h.AdminEditComment)
	adminCmt.POST("/:id/hide", h.AdminHideComment)
	adminCmt.POST("/:id/unhide", h.AdminUnhideComment)

	// Admin audit (cross-trip access tracking)
	adminAudit := api.Group("/admin/audit", auth.RequireRole(auth.RoleAdmin))
	adminAudit.GET("/events", h.AuditEvents)
	adminAudit.GET("/shares", h.AuditShares)
	adminAudit.GET("/trips", h.AuditTrips)
	adminAudit.GET("/trips/:id", h.AuditTripDetail)

	// MPS callback (real upstream is 阿里云 MPS; treat as untrusted boundary)
	api.POST("/oss/mps-callback", h.MPSCallback)

	if local, ok := ossStorage.(*oss.LocalStorage); ok {
		local.RegisterRoutes(e)
		logger.Info("local OSS mock routes registered", "data_dir", local.DataDir())
	}

	registerFrontend(e, logger)
	return e
}

func newTranscoder(cfg *config.Config, client *ent.Client, logger *slog.Logger) transcoder.Transcoder {
	onDone := func(r transcoder.Result) {
		ctx := context.Background()
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		upd := client.Asset.UpdateOneID(r.AssetID)
		if r.Status == "ready" {
			upd.SetHlsStatus(asset.HlsStatusReady)
			if r.HLSKey != "" {
				upd.SetHlsKey(r.HLSKey)
			}
		} else {
			upd.SetHlsStatus(asset.HlsStatusFailed)
		}
		if _, err := upd.Save(ctx); err != nil {
			logger.Error("transcode result update failed", "asset", r.AssetID, "err", err)
		}
	}
	if cfg.OSS.Backend == "aliyun" {
		return &transcoder.IMSTranscoder{Cfg: cfg.OSS, OnDone: onDone, Logger: logger}
	}
	return &transcoder.FakeTranscoder{Delay: 2 * time.Second, OnDone: onDone, Logger: logger}
}

func registerFrontend(e *echo.Echo, logger *slog.Logger) {
	feFS, err := frontend.FS()
	if err != nil {
		logger.Warn("frontend embed unavailable", "err", err)
		return
	}
	e.GET("/*", func(c echo.Context) error {
		req := c.Request()
		if strings.HasPrefix(req.URL.Path, "/api/") {
			return echo.ErrNotFound
		}
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := feFS.Open(path)
		if err != nil {
			f, err = feFS.Open("index.html")
			if err != nil {
				return echo.ErrNotFound
			}
			path = "index.html"
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil {
			return err
		}
		if stat.IsDir() {
			f.Close()
			f, err = feFS.Open("index.html")
			if err != nil {
				return echo.ErrNotFound
			}
			path = "index.html"
			stat, err = f.Stat()
			if err != nil {
				return err
			}
		}
		if rs, ok := f.(io.ReadSeeker); ok {
			http.ServeContent(c.Response(), req, stat.Name(), stat.ModTime(), rs)
			return nil
		}
		data, err := io.ReadAll(f)
		if err != nil {
			return err
		}
		return c.Blob(http.StatusOK, mimeFromPath(path), data)
	})
}

func mimeFromPath(p string) string {
	switch {
	case strings.HasSuffix(p, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "application/javascript"
	case strings.HasSuffix(p, ".css"):
		return "text/css"
	case strings.HasSuffix(p, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(p, ".json"):
		return "application/json"
	default:
		return "application/octet-stream"
	}
}

