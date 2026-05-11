package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type AssetView struct {
	ent.Schema
}

func (AssetView) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (AssetView) Fields() []ent.Field {
	return []ent.Field{
		field.Int("visit_id"),
		field.Int("asset_id"),
		field.Enum("kind").
			Values("view", "play_start", "play_complete").
			Default("view"),
		field.Int64("bytes_signed").Default(0),
		field.Time("viewed_at"),
	}
}

func (AssetView) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("visit", Visit.Type).
			Ref("asset_views").
			Field("visit_id").
			Required().
			Unique(),
		edge.From("asset", Asset.Type).
			Ref("views").
			Field("asset_id").
			Required().
			Unique(),
	}
}

func (AssetView) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("asset_id"),
		index.Fields("visit_id"),
	}
}
