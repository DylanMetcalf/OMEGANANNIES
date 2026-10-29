import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

export async function unreadCount(userId: string) {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.channel, "in_app"), isNull(s.notifications.readAt)));
  return r.c;
}
export async function unreadMessages(userId: string) {
  const r = await db.execute<{ c: number }>(sql`
    SELECT count(*)::int AS c FROM messages m JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ${userId} AND p.revoked_at IS NULL
    WHERE m.sender_id <> ${userId} AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)`);
  return Number(r.rows[0].c);
}
export const services = () => db.select().from(s.serviceCategories).where(eq(s.serviceCategories.active, true)).orderBy(asc(s.serviceCategories.sortOrder));
export async function serviceName(code: string) {
  const all = await services();
  return all.find((x) => x.code === code)?.name ?? code;
}
export async function bookingDetail(id: string) {
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, id));
  if (!b) return null;
  const [family] = b.familyId ? await db.select().from(s.families).where(eq(s.families.id, b.familyId)) : [];
  const [nanny] = b.nannyId ? await db.select().from(s.nannies).where(eq(s.nannies.id, b.nannyId)) : [];
  const [location] = b.serviceLocationId ? await db.select().from(s.serviceLocations).where(eq(s.serviceLocations.id, b.serviceLocationId)) : [];
  const kids = await db.select({ c: s.children }).from(s.bookingChildren).innerJoin(s.children, eq(s.children.id, s.bookingChildren.childId)).where(eq(s.bookingChildren.bookingId, id));
  const events = await db.select({ e: s.bookingEvents, actor: s.users.name }).from(s.bookingEvents).leftJoin(s.users, eq(s.users.id, s.bookingEvents.actorId)).where(eq(s.bookingEvents.bookingId, id)).orderBy(desc(s.bookingEvents.createdAt));
  const quotes = await db.select().from(s.quotations).where(eq(s.quotations.bookingId, id)).orderBy(desc(s.quotations.version));
  const invoices = await db.select().from(s.invoices).where(eq(s.invoices.bookingId, id)).orderBy(asc(s.invoices.createdAt));
  const payments = invoices.length ? await db.select().from(s.payments).where(inArray(s.payments.invoiceId, invoices.map((i) => i.id))).orderBy(desc(s.payments.createdAt)) : [];
  const meetings = await db.select().from(s.meetings).where(eq(s.meetings.bookingId, id)).orderBy(asc(s.meetings.startsAt));
  const [review] = await db.select().from(s.reviews).where(eq(s.reviews.bookingId, id));
  const [conversation] = await db.select().from(s.conversations).where(and(eq(s.conversations.bookingId, id), eq(s.conversations.kind, "booking")));
  const [share] = await db.select().from(s.locationShares).where(and(eq(s.locationShares.bookingId, id), isNull(s.locationShares.revokedAt), sql`${s.locationShares.expiresAt} > now()`)).orderBy(desc(s.locationShares.startedAt)).limit(1);
  return { b, family, nanny, location, children: kids.map((k) => k.c), events, quotes, invoices, payments, meetings, review, conversation, share, serviceName: await serviceName(b.serviceCode) };
}
export type BookingDetail = NonNullable<Awaited<ReturnType<typeof bookingDetail>>>;
