import { auditLog, type Db } from '@afi/db';

export type AuditEntry = {
  actor: { type: 'admin' | 'user' | 'system'; id?: string | null; email?: string | null };
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
  ip?: string | null;
};

export async function audit(db: Db, { actor, action, entity, entityId, diff, ip }: AuditEntry) {
  await db.insert(auditLog).values({
    actorType: actor.type,
    actorId: actor.id ?? null,
    actorEmail: actor.email ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    diff: diff ?? null,
    ip: ip ?? null,
  });
}
