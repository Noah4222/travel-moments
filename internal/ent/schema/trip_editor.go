package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// TripEditor is the join table for editor ↔ trip assignment.
type TripEditor struct {
	ent.Schema
}

func (TripEditor) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (TripEditor) Fields() []ent.Field {
	return []ent.Field{
		field.Int("trip_id"),
		field.Int("user_id"),
	}
}

func (TripEditor) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("trip", Trip.Type).
			Unique().
			Required().
			Field("trip_id"),
		edge.To("user", User.Type).
			Unique().
			Required().
			Field("user_id"),
	}
}
