package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type CollectionAsset struct {
	ent.Schema
}

func (CollectionAsset) Fields() []ent.Field {
	return []ent.Field{
		field.Int("collection_id"),
		field.Int("asset_id"),
		field.Int("sort_order").Default(0),
	}
}

func (CollectionAsset) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("collection", Collection.Type).
			Unique().
			Required().
			Field("collection_id"),
		edge.To("asset", Asset.Type).
			Unique().
			Required().
			Field("asset_id"),
	}
}
