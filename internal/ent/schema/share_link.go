package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type ShareLink struct {
	ent.Schema
}

func (ShareLink) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (ShareLink) Fields() []ent.Field {
	return []ent.Field{
		field.Enum("scope").Values("trip", "collection", "asset", "multi"),
		field.Int("trip_id"),
		field.Int("collection_id").Optional().Nillable(),
		field.Int("asset_id").Optional().Nillable(),
		field.String("code").NotEmpty().Unique().MaxLen(32),
		// Empty password_hash → no-password share (single asset shares).
		field.String("password_hash").Optional().Sensitive(),

		field.Int("parent_share_id").Optional().Nillable(),
		field.Int("created_by_user_id").Optional().Nillable(),
		field.Int("creator_visit_id").Optional().Nillable(),

		field.String("note").Optional().MaxLen(200),
		field.Int("max_uses").Optional().Nillable(),
		field.Time("expires_at").Optional().Nillable(),
		field.Time("revoked_at").Optional().Nillable(),
		// When true, visitors of this share cannot forward / generate child shares.
		field.Bool("disable_forward").Default(false),
	}
}

func (ShareLink) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("trip", Trip.Type).
			Ref("shares").
			Field("trip_id").
			Required().
			Unique(),
		edge.From("collection", Collection.Type).
			Ref("shares").
			Field("collection_id").
			Unique(),
		edge.From("created_by", User.Type).
			Ref("shares").
			Field("created_by_user_id").
			Unique(),
		edge.To("children", ShareLink.Type).
			From("parent").
			Field("parent_share_id").
			Unique(),
		edge.From("creator_visit", Visit.Type).
			Ref("created_shares").
			Field("creator_visit_id").
			Unique(),
		edge.To("visits", Visit.Type),
		edge.To("extra_trips", Trip.Type).
			Through("share_trips", ShareTrip.Type),
	}
}

func (ShareLink) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("code").Unique(),
		index.Fields("trip_id"),
		index.Fields("parent_share_id"),
	}
}
