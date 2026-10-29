import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "./audit";
import { DomainError, familyIdsOf, nannyOf } from "./bookings";
import { notify } from "./notify";
import { can, isManagement } from "./permissions";
import { rateLimit } from "./rate-limit";
import type { CurrentUser } from "./auth";

export async function listConversations(u: CurrentUser) {
  const r = await db.execute<{ id: string; subject: string; kind: string; last_message_at: Date | null; unread: number; last_body: string | null }>(sql`
    SELECT c.id, c.subject, c.kind, c.last_message_at,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ${u.id} AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread,
      (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
    FROM conversations c JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ${u.id} AND p.revoked_at IS NULL
    ORDER BY c.last_message_at DESC NULLS LAST`);
  return r.rows;
}

/** Participants read their threads; management may read others only with messages.oversee, and that access is audited. */
export async function openThread(u: CurrentUser, id: string) {
  const [c] = await db.select().from(s.conversations).where(eq(s.conversations.id, id));
  if (!c) return null;
  const [p] = await db.select().from(s.conversationParticipants).where(and(eq(s.conversationParticipants.conversationId, id), eq(s.conversationParticipants.userId, u.id), isNull(s.conversationParticipants.revokedAt)));
  if (!p) {
    if (!can(u, "messages.oversee")) return null;
    await audit(u.id, "messages.oversight_view", "conversation", id);
  } else await db.update(s.conversationParticipants).set({ lastReadAt: new Date() }).where(and(eq(s.conversationParticipants.conversationId, id), eq(s.conversationParticipants.userId, u.id)));
  const msgs = await db.select({ m: s.messages, sender: s.users.name, senderId: s.users.id }).from(s.messages).innerJoin(s.users, eq(s.users.id, s.messages.senderId)).where(eq(s.messages.conversationId, id)).orderBy(s.messages.createdAt).limit(500);
  return { c, messages: msgs, participant: !!p };
}

export async function sendMessage(u: CurrentUser, conversationId: string, body: string) {
  const text = body.trim();
  if (!text) throw new DomainError("Write a message first.");
  if (text.length > 4000) throw new DomainError("Messages are limited to 4,000 characters.");
  if (!(await rateLimit(`msg:${u.id}`, 20, 60))) throw new DomainError("You're sending messages too quickly. Please wait a moment.");
  const [p] = await db.select().from(s.conversationParticipants).where(and(eq(s.conversationParticipants.conversationId, conversationId), eq(s.conversationParticipants.userId, u.id), isNull(s.conversationParticipants.revokedAt)));
  const [c] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId));
  if (!c || (!p && !(isManagement(u) && c.kind !== "booking"))) throw new DomainError("Conversation not found.");
  if (c.locked) throw new DomainError("This conversation is closed.");
  if (!p) await db.insert(s.conversationParticipants).values({ conversationId, userId: u.id }).onConflictDoNothing();
  const [m] = await db.insert(s.messages).values({ conversationId, senderId: u.id, body: text }).returning();
  await db.update(s.conversations).set({ lastMessageAt: new Date() }).where(eq(s.conversations.id, conversationId));
  await db.update(s.conversationParticipants).set({ lastReadAt: new Date() }).where(and(eq(s.conversationParticipants.conversationId, conversationId), eq(s.conversationParticipants.userId, u.id)));
  const others = await db.select({ id: s.conversationParticipants.userId }).from(s.conversationParticipants).where(and(eq(s.conversationParticipants.conversationId, conversationId), isNull(s.conversationParticipants.revokedAt)));
  for (const o of others.filter((x) => x.id !== u.id))
    await notify(o.id, "new_message", { subject: c.subject, sender: u.name }, `msg:${conversationId}:${Math.floor(Date.now() / 600_000)}`, `/messages/${conversationId}`); // batched per 10 min
  return m;
}

/** Families and nannies open a conversation with the Omega team. */
export async function startWithManagement(u: CurrentUser, subject: string, body: string) {
  if (!subject.trim()) throw new DomainError("Add a subject.");
  const fam = u.roles.includes("family") ? (await familyIdsOf(u.id))[0] : null;
  const nanny = u.roles.includes("nanny") ? await nannyOf(u.id) : null;
  const [c] = await db.insert(s.conversations).values({ kind: nanny ? "nanny_management" : "family_management", familyId: fam ?? null, nannyId: nanny?.id ?? null, subject: subject.trim().slice(0, 140), lastMessageAt: new Date() }).returning();
  await db.insert(s.conversationParticipants).values({ conversationId: c.id, userId: u.id });
  await sendMessage(u, c.id, body);
  return c;
}

export async function reportMessage(u: CurrentUser, messageId: string, reason: string) {
  const [m] = await db.select().from(s.messages).where(eq(s.messages.id, messageId));
  if (!m || !(await openThread(u, m.conversationId))) throw new DomainError("Message not found.");
  await db.update(s.messages).set({ flaggedAt: new Date(), flagReason: reason.slice(0, 500) || "Reported" }).where(eq(s.messages.id, messageId));
  await db.insert(s.supportRequests).values({ userId: u.id, subject: "Reported message", body: `Message ${messageId} reported: ${reason}`, category: "safeguarding" });
  await audit(u.id, "message.report", "message", messageId);
}

export async function managementInbox() {
  return db.select().from(s.conversations).orderBy(desc(s.conversations.lastMessageAt)).limit(100);
}
