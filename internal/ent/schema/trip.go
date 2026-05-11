package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Trip struct {
	ent.Schema
}

func (Trip) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (Trip) Fields() []ent.Field {
	return []ent.Field{
		field.String("slug").NotEmpty().Unique().MaxLen(64),
		field.String("title").NotEmpty().MaxLen(200),
		field.Text("description").Optional(),
		field.String("location").Optional().MaxLen(200),
		field.Time("started_at").Optional().Nillable(),
		field.Time("ended_at").Optional().Nillable(),
		field.Int("cover_asset_id").Optional().Nillable(),
		field.Int("created_by_id"),
		// Show per-asset view counters to visitors of this trip.
		field.Bool("show_view_counts").Default(false),
	}
}

func (Trip) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("created_by", User.Type).
			Ref("created_trips").
			Field("created_by_id").
			Required().
			Unique(),
		edge.From("editors", User.Type).
			Ref("editor_trips").
			Through("trip_editors", TripEditor.Type),
		edge.To("assets", Asset.Type),
		edge.To("collections", Collection.Type),
		edge.To("shares", ShareLink.Type),
		edge.From("multi_shares", ShareLink.Type).
			Ref("extra_trips").
			Through("share_trips", ShareTrip.Type),
		edge.To("upload_grants", UploadGrant.Type),
	}
}

func (Trip) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("slug").Unique(),
	}
}
