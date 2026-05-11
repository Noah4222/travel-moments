package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Comment struct {
	ent.Schema
}

func (Comment) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (Comment) Fields() []ent.Field {
	return []ent.Field{
		field.Enum("target_type").Values("trip", "asset"),
		field.Int("target_id"),
		field.Int("visit_id").Optional().Nillable(),
		field.Int("user_id").Optional().Nillable(),
		field.Int("asset_id").Optional().Nillable(), // populated when target_type=asset, for FK
		field.String("display_name").NotEmpty().MaxLen(40),
		field.String("content").NotEmpty().MaxLen(200),
		field.String("color").Optional().MaxLen(16),
		field.Int("video_time_ms").Optional().Nillable(),
		field.Time("hidden_at").Optional().Nillable(),
		field.Int("hidden_by_id").Optional().Nillable(),
		field.Time("edited_at").Optional().Nillable(),
	}
}

func (Comment) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("visit", Visit.Type).
			Ref("comments").
			Field("visit_id").
			Unique(),
		edge.From("asset", Asset.Type).
			Ref("comments").
			Field("asset_id").
			Unique(),
	}
}

func (Comment) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("target_type", "target_id"),
		index.Fields("hidden_at"),
	}
}
