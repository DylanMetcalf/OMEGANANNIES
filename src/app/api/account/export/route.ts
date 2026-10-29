import { eq, inArray, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { familyIdsOf, nannyOf } from "@/lib/bookings";
import { rateLimit } from "@/lib/rate-limit";

/** POPIA access request: the signed-in user's own records as JSON. Never includes other people's data or secrets. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorised", { status: 401 });
  if (!(await rateLimit(`export:${u.id}`, 5, 3600))) return new Response("Too many exports", { status: 429 });
  const [user] = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, phone: s.users.phone, createdAt: s.users.createdAt, lastLoginAt: s.users.lastLoginAt }).from(s.users).where(eq(s.users.id, u.id));
  const familyIds = await familyIdsOf(u.id);
  const nanny = await nannyOf(u.id);
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), user, consents: await db.select().from(s.consents).where(eq(s.consents.userId, u.id)) };
  if (familyIds.length) {
    data.households = await db.select().from(s.families).where(inArray(s.families.id, familyIds));
    data.children = await db.select().from(s.children).where(inArray(s.children.familyId, familyIds));
    data.locations = await db.select().from(s.serviceLocations).where(inArray(s.serviceLocations.familyId, familyIds));
    const bookings = await db.select().from(s.bookings).where(inArray(s.bookings.familyId, familyIds));
    data.bookings = bookings;
    if (bookings.length) data.invoices = await db.select().from(s.invoices).where(inArray(s.invoices.bookingId, bookings.map((b) => b.id)));
  }
  if (nanny) {
    const { internalNotes: _internal, ...profile } = nanny;
    data.nannyProfile = profile;
    data.documents = (await db.select().from(s.documents).where(eq(s.documents.ownerNannyId, nanny.id))).map(({ storageKey: _k, ...d }) => d);
    data.availability = await db.select().from(s.availabilityRules).where(eq(s.availabilityRules.nannyId, nanny.id));
  }
  data.messagesSent = await db.select({ id: s.messages.id, conversationId: s.messages.conversationId, body: s.messages.body, createdAt: s.messages.createdAt }).from(s.messages).where(eq(s.messages.senderId, u.id));
  data.notifications = await db.select({ subject: s.notifications.subject, createdAt: s.notifications.createdAt }).from(s.notifications).where(or(eq(s.notifications.userId, u.id)));
  await audit(u.id, "privacy.export", "user", u.id);
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="omega-my-data-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
