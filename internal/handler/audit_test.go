package handler_test

import (
	"net/http"
	"testing"

	"github.com/cloverstd/travel-moments/internal/ent/user"
)

func TestAuditEndpointsPermissions(t *testing.T) {
	te := newTestEnv(t)
	te.seedUser(user.RoleAdmin, "admin", "pw")
	editorID := te.seedUser(user.RoleEditor, "editor", "pw")
	// Editor accounts can't log in (blocked in production), so mint a JWT
	// directly to exercise the role-based middleware.
	editorTok, _, err := te.handler.JWT.Sign(editorID, string(user.RoleEditor))
	if err != nil {
		t.Fatal(err)
	}

	endpoints := []string{
		"/api/admin/audit/events",
		"/api/admin/audit/shares",
		"/api/admin/audit/trips",
		"/api/admin/audit/trips/1",
	}
	for _, p := range endpoints {
		// Anonymous
		r := te.do("GET", p, "", nil, "")
		r.Body.Close()
		if r.StatusCode != http.StatusUnauthorized {
			t.Errorf("anon %s: want 401, got %d", p, r.StatusCode)
		}
		// Editor
		r = te.do("GET", p, editorTok, nil, "")
		r.Body.Close()
		if r.StatusCode != http.StatusForbidden {
			t.Errorf("editor %s: want 403, got %d", p, r.StatusCode)
		}
	}
}
