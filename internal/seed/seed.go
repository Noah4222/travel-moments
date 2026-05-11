package seed

import (
	"context"
	"errors"
	"log/slog"

	"github.com/cloverstd/travel-moments/internal/auth"
	"github.com/cloverstd/travel-moments/internal/ent"
	"github.com/cloverstd/travel-moments/internal/ent/user"
)

// EnsureAdmin creates the initial admin if no admin exists yet.
func EnsureAdmin(ctx context.Context, client *ent.Client, username, password string, log *slog.Logger) error {
	if username == "" || password == "" {
		return nil
	}
	exists, err := client.User.Query().Where(user.RoleEQ(user.RoleAdmin)).Exist(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	created, err := client.User.Create().
		SetUsername(username).
		SetPasswordHash(hash).
		SetRole(user.RoleAdmin).
		Save(ctx)
	if err != nil {
		// race-safe fallback
		if ent.IsConstraintError(err) {
			return nil
		}
		return errors.Join(errors.New("create seed admin failed"), err)
	}
	log.Info("seed admin created", "id", created.ID, "username", created.Username)
	return nil
}
