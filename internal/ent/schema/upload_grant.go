package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// UploadGrant is a one-shot link that lets a non-account visitor upload assets
// to a specific trip. The actual access token lives only in the URL `#hash`;
// the DB stores its bcrypt hash. Hitting consume marks the grant used; the
// returned short-lived upload JWT keeps the open tab functional until it
// expires, but reopening the same URL fails.
type UploadGrant struct {
	ent.Schema
}

func (UploadGrant) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (UploadGrant) Fields() []ent.Field {
	return []ent.Field{
		field.String("code").NotEmpty().Unique().MaxLen(32),
		field.String("token_hash").NotEmpty().Sensitive(),
		field.Int("trip_id"),
		field.Int("created_by_user_id"),
		field.String("note").Optional().MaxLen(200),
		field.Time("expires_at"),
		field.Time("consumed_at").Optional().Nillable(),
		field.String("consumed_ip").Optional().MaxLen(64),
		field.String("consumed_ua").Optional().MaxLen(255),
		field.Time("revoked_at").Optional().Nillable(),
	}
}

func (UploadGrant) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("trip", Trip.Type).
			Ref("upload_grants").
			Field("trip_id").
			Required().
			Unique(),
		edge.From("created_by", User.Type).
			Ref("upload_grants").
			Field("created_by_user_id").
			Required().
			Unique(),
	}
}

func (UploadGrant) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("code").Unique(),
		index.Fields("trip_id"),
	}
}
