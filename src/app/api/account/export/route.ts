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
    data.shortlist = await db.select({ nannyId: s.favourites.nannyId, savedAt: s.favourites.createdAt }).from(s.favourites).where(inArray(s.favourites.familyId, familyIds));
    data.recentlyViewed = await db.select().from(s.nannyViews).where(inArray(s.nannyViews.familyId, familyIds));
    data.savedSearches = await db.select({ name: s.savedSearches.name, params: s.savedSearches.params, createdAt: s.savedSearches.createdAt }).from(s.savedSearches).where(inArray(s.savedSearches.familyId, familyIds));
    data.bookingDraft = await db.select({ params: s.bookingDrafts.params, updatedAt: s.bookingDrafts.updatedAt }).from(s.bookingDrafts).where(inArray(s.bookingDrafts.familyId, familyIds));
    data.rewardsLedger = await db.select({ kind: s.loyaltyLedger.kind, delta: s.loyaltyLedger.delta, reason: s.loyaltyLedger.reason, note: s.loyaltyLedger.note, createdAt: s.loyaltyLedger.createdAt }).from(s.loyaltyLedger).where(inArray(s.loyaltyLedger.familyId, familyIds));
  }
  // Calendar connections without tokens; notification preferences and channel consents.
  data.calendarConnections = await db.select({ provider: s.calendarConnections.provider, accountEmail: s.calendarConnections.accountEmail, status: s.calendarConnections.status, pushBookings: s.calendarConnections.pushBookings, importBusy: s.calendarConnections.importBusy, createdAt: s.calendarConnections.createdAt }).from(s.calendarConnections).where(eq(s.calendarConnections.userId, u.id));
  data.notificationPreferences = await db.select({ channels: s.notificationPreferences.channels, marketingOptIn: s.notificationPreferences.marketingOptIn, smsConsentAt: s.notificationPreferences.smsConsentAt, whatsappConsentAt: s.notificationPreferences.whatsappConsentAt }).from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, u.id));
  if (nanny) {
    const { internalNotes: _internal, ...profile } = nanny;
    data.nannyProfile = profile;
    data.documents = (await db.select().from(s.documents).where(eq(s.documents.ownerNannyId, nanny.id))).map(({ storageKey: _k, ...d }) => d);
    data.availability = await db.select().from(s.availabilityRules).where(eq(s.availabilityRules.nannyId, nanny.id));
  }
  data.messagesSent = await db.select({ id: s.messages.id, conversationId: s.messages.conversationId, body: s.messages.body, createdAt: s.messages.createdAt }).from(s.messages).where(eq(s.messages.senderId, u.id));
  data.notifications = await db.select({ subject: s.notifications.subject, channel: s.notifications.channel, status: s.notifications.status, createdAt: s.notifications.createdAt }).from(s.notifications).where(or(eq(s.notifications.userId, u.id)));
  await audit(u.id, "privacy.export", "user", u.id);
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="omega-my-data-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
