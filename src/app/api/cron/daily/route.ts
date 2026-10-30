import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { deliverPending, notify } from "@/lib/notify";
import { fmtDate } from "@/lib/time";

/** Scheduled maintenance (e.g. Vercel Cron, hourly): reminders, expiry, retention, email retries. Bearer CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorised", { status: 401 });
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // Safeguarding checks & documents expiring within 30 days → reminder to nanny (deduped per item).
  const expiring = await db.select({ c: s.verificationChecks, userId: s.nannies.userId }).from(s.verificationChecks).innerJoin(s.nannies, eq(s.nannies.id, s.verificationChecks.nannyId))
    .where(and(eq(s.verificationChecks.status, "passed"), sql`${s.verificationChecks.expiresOn} <= ${in30}`));
  for (const { c, userId } of expiring) if (userId) await notify(userId, "document_expiring", { doc: c.kind.replace("_", " "), when: fmtDate(c.expiresOn!) }, `expiry:${c.id}:${c.expiresOn}`, "/nanny/documents");
  const expired = await db.update(s.verificationChecks).set({ status: "expired" }).where(and(eq(s.verificationChecks.status, "passed"), sql`${s.verificationChecks.expiresOn} < ${today}`)).returning();
  await db.update(s.documents).set({ status: "expired" }).where(and(eq(s.documents.status, "approved"), sql`${s.documents.expiresOn} < ${today}`));
  // Quotations past validity.
  await db.update(s.quotations).set({ status: "expired" }).where(and(eq(s.quotations.status, "sent"), lt(s.quotations.validUntil, new Date())));
  // Location retention: clear coordinates once sharing ends.
  await db.update(s.locationShares).set({ lat: null, lng: null, accuracyM: null }).where(and(lt(s.locationShares.expiresAt, new Date()), sql`${s.locationShares.lat} IS NOT NULL`));
  await db.update(s.locationShares).set({ lat: null, lng: null }).where(and(sql`${s.locationShares.revokedAt} IS NOT NULL`, sql`${s.locationShares.lat} IS NOT NULL`));
  // Unpaid holds keep the nanny blocked. Flag them to management once (auto-release is a business decision, not automated).
  const stale = await db.select({ b: s.bookings }).from(s.bookings).innerJoin(s.quotations, and(eq(s.quotations.bookingId, s.bookings.id), eq(s.quotations.status, "accepted")))
    .where(and(eq(s.bookings.status, "awaiting_payment"), lt(s.quotations.acceptedAt, new Date(Date.now() - 48 * 3600_000)),
      sql`NOT EXISTS (SELECT 1 FROM tasks t WHERE t.booking_id = ${s.bookings.id} AND t.title LIKE 'Unpaid hold%')`));
  for (const { b } of stale) await db.insert(s.tasks).values({ title: `Unpaid hold: ${b.reference}`, notes: "Quotation accepted over 48 hours ago and the deposit is unpaid. The nanny remains held — follow up with the family or cancel to release the nanny.", priority: "high", bookingId: b.id, familyId: b.familyId });
  // Housekeeping.
  await db.delete(s.rateLimits).where(lt(s.rateLimits.windowStart, new Date(Date.now() - 86400_000)));
  await db.delete(s.sessions).where(lt(s.sessions.expiresAt, new Date()));
  await db.delete(s.authTokens).where(and(lt(s.authTokens.expiresAt, new Date(Date.now() - 30 * 86400_000)), isNull(s.authTokens.usedAt)));
  const sent = await deliverPending(200);
  return Response.json({ unpaidHoldsFlagged: stale.length, reminders: expiring.length, expiredChecks: expired.length, emailsProcessed: sent });
}
