package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ShareTrip is the join table connecting a "multi" share with the trips it
// exposes (one share → many trips).
type ShareTrip struct {
	ent.Schema
}

func (ShareTrip) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (ShareTrip) Fields() []ent.Field {
	return []ent.Field{
		field.Int("share_id"),
		field.Int("trip_id"),
		field.Int("sort_order").Default(0),
	}
}

func (ShareTrip) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("share", ShareLink.Type).
			Unique().
			Required().
			Field("share_id"),
		edge.To("trip", Trip.Type).
			Unique().
			Required().
			Field("trip_id"),
	}
}

func (ShareTrip) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("share_id", "trip_id").Unique(),
	}
}
