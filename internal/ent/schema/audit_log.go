package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type AuditLog struct {
	ent.Schema
}

func (AuditLog) Fields() []ent.Field {
	return []ent.Field{
		field.Int("actor_user_id").Optional().Nillable(),
		field.String("action").NotEmpty().MaxLen(64),
		field.String("target_type").Optional().MaxLen(32),
		field.Int("target_id").Optional().Nillable(),
		field.JSON("meta", map[string]any{}).Optional(),
		field.Time("at"),
	}
}

func (AuditLog) Edges() []ent.Edge {
	return nil
}

func (AuditLog) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("actor_user_id"),
		index.Fields("target_type", "target_id"),
	}
}
