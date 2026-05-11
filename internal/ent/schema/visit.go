package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Visit struct {
	ent.Schema
}

func (Visit) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (Visit) Fields() []ent.Field {
	return []ent.Field{
		field.Int("share_id"),
		field.String("session_id").NotEmpty().MaxLen(64),
		field.String("ip").Optional().MaxLen(64),
		field.String("ua").Optional().MaxLen(512),
		field.String("referer").Optional().MaxLen(512),
		field.String("country").Optional().MaxLen(8),
		field.Time("visited_at"),
	}
}

func (Visit) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("share", ShareLink.Type).
			Ref("visits").
			Field("share_id").
			Required().
			Unique(),
		edge.To("asset_views", AssetView.Type),
		edge.To("created_shares", ShareLink.Type),
		edge.To("comments", Comment.Type),
	}
}

func (Visit) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("share_id"),
		index.Fields("session_id"),
	}
}
