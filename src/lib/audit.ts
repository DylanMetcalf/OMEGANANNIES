import { db, type Tx, schema as s } from "@/db";

/** Append-only audit trail. Never put secrets, card data or children's medical details in `detail`. */
export async function audit(actorId: string | null, action: string, entity: string, entityId: string | null, detail?: Record<string, unknown>, tx?: Tx, ip?: string) {
  await (tx ?? db).insert(s.auditEvents).values({ actorId, action, entity, entityId, detail: detail ?? null, ip: ip ?? null });
}
