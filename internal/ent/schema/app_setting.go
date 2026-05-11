package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AppSetting is a simple key/value table for admin-tunable runtime settings.
// Use the settings package to read/write — it caches values in memory.
type AppSetting struct {
	ent.Schema
}

func (AppSetting) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (AppSetting) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").NotEmpty().Unique().MaxLen(64),
		field.Text("value"),
	}
}

func (AppSetting) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("key").Unique(),
	}
}
