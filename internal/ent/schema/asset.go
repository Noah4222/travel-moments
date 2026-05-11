package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Asset struct {
	ent.Schema
}

func (Asset) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (Asset) Fields() []ent.Field {
	return []ent.Field{
		field.Int("trip_id"),
		field.Int("uploaded_by_id"),
		field.Enum("kind").Values("photo", "video"),
		field.String("oss_key").NotEmpty(),
		field.String("mime").Optional(),
		field.Int64("size").Default(0),
		field.Int("width").Optional(),
		field.Int("height").Optional(),
		field.Int("duration_ms").Optional(), // video only
		field.Time("taken_at").Optional().Nillable(),
		field.Enum("hls_status").
			Values("none", "pending", "ready", "failed").
			Default("none"),
		field.String("hls_key").Optional(),
		field.String("thumb_key").Optional(),
		field.Int("sort_order").Default(0),
		// Live photo (iPhone): JPEG/HEIC photo paired with a short MOV.
		field.Bool("is_live_photo").Default(false),
		field.String("motion_key").Optional(),
		field.String("motion_mime").Optional(),
		// EXIF / image-info metadata cached from OSS image/info.
		field.JSON("exif", map[string]any{}).Optional(),
	}
}

func (Asset) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("trip", Trip.Type).
			Ref("assets").
			Field("trip_id").
			Required().
			Unique(),
		edge.From("uploaded_by", User.Type).
			Ref("uploaded_assets").
			Field("uploaded_by_id").
			Required().
			Unique(),
		edge.From("collections", Collection.Type).
			Ref("assets").
			Through("collection_assets", CollectionAsset.Type),
		edge.To("views", AssetView.Type),
		edge.To("comments", Comment.Type),
	}
}

func (Asset) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("trip_id"),
		index.Fields("trip_id", "sort_order"),
	}
}
