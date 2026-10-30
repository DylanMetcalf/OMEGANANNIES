import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { env } from "./env";
import { publishedPriceBook } from "./bookings";
import { calculateQuote, PricingError } from "./pricing";
import { buildSessions, careDates, hhmmToMinutes } from "./time";
import { classify, EMPTY_REQ, parseReq, type Availability, type Req } from "./journey-core";

export type Draft = { req: Req; prefs: string[]; assistance: boolean; key: string; step: string; updatedAt: Date | null };

export async function getDraft(familyId: string): Promise<Draft> {
  const [d] = await db.select().from(s.bookingDrafts).where(eq(s.bookingDrafts.familyId, familyId));
  const p = (d?.params ?? {}) as Record<string, unknown>;
  return {
    req: d ? parseReq(p) : { ...EMPTY_REQ }, prefs: Array.isArray(p.prefs) ? (p.prefs as string[]).filter((x) => typeof x === "string").slice(0, 3) : [],
    assistance: p.assistance === true, key: typeof p.key === "string" ? p.key : randomUUID(), step: d?.step ?? "requirements", updatedAt: d?.updatedAt ?? null,
  };
}
export async function saveDraft(familyId: string, userId: string, d: Partial<Omit<Draft, "updatedAt">>) {
  const cur = await getDraft(familyId);
  const next = { ...cur, ...d };
  const params = { ...reqForStore(next.req), prefs: next.prefs, assistance: next.assistance, key: next.key };
  await db.insert(s.bookingDrafts).values({ familyId, userId, params, step: next.step }).onConflictDoUpdate({ target: s.bookingDrafts.familyId, set: { params, step: next.step, userId, updatedAt: new Date() } });
}
const reqForStore = (r: Req) => ({ ...r, recurring: r.recurring ? "1" : "", driver: r.driver ? "1" : "", specialist: r.specialist ? "1" : "", minExp: String(r.minExp) });
export const clearDraft = (familyId: string) => db.delete(s.bookingDrafts).where(eq(s.bookingDrafts.familyId, familyId));

/** Public discovery projection: approved + published only. Never checks, documents, contacts or internal notes. */
const CARD = {
  id: s.nannies.id, slug: s.nannies.slug, displayName: s.nannies.displayName, headline: s.nannies.headline, bio: s.nannies.bio,
  yearsExperience: s.nannies.yearsExperience, languages: s.nannies.languages, areas: s.nannies.areas, skills: s.nannies.skills, ageGroups: s.nannies.ageGroups,
  services: s.nannies.services, canDrive: s.nannies.canDrive, specialistExperience: s.nannies.specialistExperience, photoUrl: s.nannies.photoUrl, isDemo: s.nannies.isDemo,
};
export type CardNanny = { [K in keyof typeof CARD]: (typeof s.nannies.$inferSelect)[K] };
export const visibleNannies = () => db.select(CARD).from(s.nannies).where(and(eq(s.nannies.status, "approved"), eq(s.nannies.published, true), eq(s.nannies.isDemo, env.demo))).orderBy(asc(s.nannies.displayName)).limit(500);

export function sessionsFor(r: Req) {
  if (!r.start) return [];
  const liveIn = r.service === "live_in";
  return buildSessions({ startDate: r.start, endDate: r.end || r.start, dailyStartMinute: liveIn ? 480 : hhmmToMinutes(r.t1), dailyEndMinute: liveIn ? 480 : hhmmToMinutes(r.t2), timeZone: "Africa/Johannesburg", liveIn, weekdays: r.recurring && r.weekdays.length && r.weekdays.length < 7 ? r.weekdays : null });
}
/** Indicative availability for the requested sessions: existing holds, time off and calendar busy periods. */
export async function availabilityFor(ids: string[], r: Req): Promise<Record<string, Availability>> {
  const sess = sessionsFor(r);
  if (!ids.length || !sess.length) return Object.fromEntries(ids.map((i) => [i, null]));
  const from = new Date(Math.min(...sess.map((x) => x.startsAt.getTime()))), to = new Date(Math.max(...sess.map((x) => x.endsAt.getTime())));
  const [held, off, cal] = await Promise.all([
    db.select({ id: s.bookingSessions.nannyId, startsAt: s.bookingSessions.startsAt, endsAt: s.bookingSessions.endsAt }).from(s.bookingSessions).where(and(eq(s.bookingSessions.blocking, true), inArray(s.bookingSessions.nannyId, ids), lt(s.bookingSessions.startsAt, to), gt(s.bookingSessions.endsAt, from))),
    db.select({ id: s.availabilityExceptions.nannyId, startsAt: s.availabilityExceptions.startsAt, endsAt: s.availabilityExceptions.endsAt }).from(s.availabilityExceptions).where(and(ne(s.availabilityExceptions.kind, "available"), inArray(s.availabilityExceptions.nannyId, ids), lt(s.availabilityExceptions.startsAt, to), gt(s.availabilityExceptions.endsAt, from))),
    db.select({ id: s.calendarBusyBlocks.nannyId, startsAt: s.calendarBusyBlocks.startsAt, endsAt: s.calendarBusyBlocks.endsAt }).from(s.calendarBusyBlocks).where(and(inArray(s.calendarBusyBlocks.nannyId, ids), lt(s.calendarBusyBlocks.startsAt, to), gt(s.calendarBusyBlocks.endsAt, from))),
  ]);
  const busy = [...held, ...off, ...cal];
  return Object.fromEntries(ids.map((id) => [id, classify(sess, busy.filter((b) => b.id === id))]));
}
export async function ratingsFor(ids: string[]) {
  if (!ids.length) return {} as Record<string, { avg: number; n: number }>;
  const r = await db.select({ id: s.reviews.nannyId, avg: sql<number>`round(avg(${s.reviews.rating})::numeric,1)::float`, n: sql<number>`count(*)::int` }).from(s.reviews).where(and(inArray(s.reviews.nannyId, ids), eq(s.reviews.status, "published"))).groupBy(s.reviews.nannyId);
  return Object.fromEntries(r.map((x) => [x.id, { avg: x.avg, n: x.n }]));
}
export async function shortlistOf(familyId: string) {
  return (await db.select({ id: s.favourites.nannyId }).from(s.favourites).where(eq(s.favourites.familyId, familyId)).orderBy(asc(s.favourites.createdAt))).map((x) => x.id);
}
export async function recordView(familyId: string, nannyId: string) {
  await db.insert(s.nannyViews).values({ familyId, nannyId }).onConflictDoUpdate({ target: [s.nannyViews.familyId, s.nannyViews.nannyId], set: { viewedAt: new Date() } });
}
export async function recentlyViewed(familyId: string, limit = 6) {
  return db.select(CARD).from(s.nannyViews).innerJoin(s.nannies, eq(s.nannies.id, s.nannyViews.nannyId))
    .where(and(eq(s.nannyViews.familyId, familyId), eq(s.nannies.status, "approved"), eq(s.nannies.published, true))).orderBy(desc(s.nannyViews.viewedAt)).limit(limit);
}

/** Indicative estimate from the published price book. Never a quotation: management confirms the final price. */
export async function estimateFor(r: Req, familyId: string) {
  if (!r.service || !r.start) return null;
  const pb = await publishedPriceBook();
  if (!pb) return { error: "Pricing is confirmed in your quotation." } as const;
  const [fam] = await db.select({ audience: s.families.audience }).from(s.families).where(eq(s.families.id, familyId));
  const liveIn = r.service === "live_in";
  const b = { startDate: r.start, endDate: r.end || r.start, weekdays: r.recurring && r.weekdays.length < 7 ? r.weekdays : null, liveIn };
  const hol = await db.select().from(s.publicHolidays).where(and(sql`${s.publicHolidays.day} >= ${b.startDate}`, sql`${s.publicHolidays.day} <= ${b.endDate}`));
  try {
    const q = calculateQuote(pb.items, { audience: fam?.audience ?? "visiting", serviceCode: r.service, dates: careDates(b), dailyStartMinute: liveIn ? 480 : hhmmToMinutes(r.t1), dailyEndMinute: liveIn ? 480 : hhmmToMinutes(r.t2), liveIn, overnight: false, specialist: r.specialist, travelTrips: 0, publicHolidays: new Set(hol.map((h) => h.day)) }, pb.book.currency);
    return { total: q.subtotalMinor, deposit: q.depositMinor, currency: q.currency, days: careDates(b).length, assumptions: q.assumptions } as const;
  } catch (e) {
    if (e instanceof PricingError) return { error: "This service is priced individually — we'll include it in your quotation." } as const;
    throw e;
  }
}
