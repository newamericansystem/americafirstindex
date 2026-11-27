import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: text('actor_type').notNull(), // 'admin' | 'user' | 'system'
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(), // 'endorsement.update', ...
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    diff: jsonb('diff'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_created_idx').on(t.createdAt),
  ],
);
