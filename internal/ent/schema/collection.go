package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Collection struct {
	ent.Schema
}

func (Collection) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (Collection) Fields() []ent.Field {
	return []ent.Field{
		field.Int("trip_id"),
		field.Int("created_by_id"),
		field.String("title").NotEmpty().MaxLen(200),
		field.Text("description").Optional(),
	}
}

func (Collection) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("trip", Trip.Type).
			Ref("collections").
			Field("trip_id").
			Required().
			Unique(),
		edge.To("assets", Asset.Type).
			Through("collection_assets", CollectionAsset.Type),
		edge.To("shares", ShareLink.Type),
	}
}

func (Collection) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("trip_id"),
	}
}
