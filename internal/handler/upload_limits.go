package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// PublicUploadLimits exposes the read-only knobs the client needs to drive
// uploads. No authentication is required — these are not sensitive (they
// describe behaviour, not credentials) and both logged-in admins and
// one-shot upload-grant visitors need them.
func (h *Handler) PublicUploadLimits(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"concurrency": h.Settings.UploadConcurrency(),
	})
}
