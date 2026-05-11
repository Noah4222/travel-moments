package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// UserCredential stores a WebAuthn (Passkey) credential for a user.
type UserCredential struct {
	ent.Schema
}

func (UserCredential) Mixin() []ent.Mixin {
	return []ent.Mixin{TimeMixin{}}
}

func (UserCredential) Fields() []ent.Field {
	return []ent.Field{
		field.Int("user_id"),
		field.String("name").Optional().MaxLen(80),
		field.Bytes("credential_id"),
		field.Bytes("public_key"),
		field.String("attestation_type").Optional().MaxLen(32),
		field.Bytes("aaguid").Optional(),
		field.Uint32("sign_count").Default(0),
		field.String("transports").Optional().MaxLen(255),
		field.Bool("backup_eligible").Default(false),
		field.Bool("backup_state").Default(false),
		field.Time("last_used_at").Optional().Nillable(),
	}
}

func (UserCredential) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).
			Ref("credentials").
			Field("user_id").
			Required().
			Unique(),
	}
}

func (UserCredential) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
		index.Fields("credential_id").Unique(),
	}
}
