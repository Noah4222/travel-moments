package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// All endpoints in this file are mounted under /api/admin/audit and require
// admin role. Group-level middleware enforces auth; handlers do not re-check.

func (h *Handler) AuditEvents(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditShares(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTrips(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}

func (h *Handler) AuditTripDetail(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "not implemented")
}
