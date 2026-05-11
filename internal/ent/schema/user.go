package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type User struct {
	ent.Schema
}

func (User) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("username").NotEmpty().Unique().MaxLen(64),
		field.String("password_hash").NotEmpty().Sensitive(),
		field.Enum("role").Values("admin", "editor"),
		field.Bool("disabled").Default(false),
		// TOTP / two-factor: secret is the base32-encoded shared secret
		// (only set after the user clicks "enable"); enabled gates the
		// challenge step at login. Skipped when the user signs in via Passkey.
		field.String("totp_secret").Optional().Sensitive(),
		field.Bool("totp_enabled").Default(false),
	}
}

func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("created_trips", Trip.Type),
		edge.To("editor_trips", Trip.Type).
			Through("trip_editors", TripEditor.Type),
		edge.To("uploaded_assets", Asset.Type),
		edge.To("shares", ShareLink.Type),
		edge.To("upload_grants", UploadGrant.Type),
		edge.To("credentials", UserCredential.Type),
	}
}

func (User) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("username").Unique(),
	}
}
