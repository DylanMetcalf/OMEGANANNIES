import "server-only";
import { and, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db, type Tx, schema as s } from "@/db";
import { audit } from "./audit";
import { BLOCKING, canTransition, type Actor, type BookingStatus } from "./booking-state";
import { randomToken } from "./crypto";
import { formatMoney } from "./money";
import { notify, notifyMany } from "./notify";
import { can, isManagement, type Permission } from "./permissions";
import { calculateQuote, type PriceItem } from "./pricing";
import { rank, type Candidate, type MatchRequirements } from "./matching";
import { ageFrom, ageGroup, buildSessions, eachDate, fmtDate, weekday } from "./time";
import type { CurrentUser } from "./auth";

export class DomainError extends Error {}
export class ConflictError extends DomainError {}
type Booking = typeof s.bookings.$inferSelect;

// ---------------- Access policy ----------------
export async function familyIdsOf(userId: string, tx: Tx | typeof db = db): Promise<string[]> {
  return (await tx.select({ id: s.familyMembers.familyId }).from(s.familyMembers).where(eq(s.familyMembers.userId, userId))).map((r) => r.id);
}
export async function nannyOf(userId: string) {
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.userId, userId));
  return n ?? null;
}
export type Access = { level: "none" | "family" | "nanny" | "management"; sensitive: boolean; preciseLocation: boolean };
const NANNY_VISIBLE: BookingStatus[] = ["introduction", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "in_progress", "completed", "disputed"];
const NANNY_FULL: BookingStatus[] = ["confirmed", "in_progress"];

/** Single source of truth for who may see what on a booking. Enforced server-side on every read. */
export async function bookingAccess(u: CurrentUser, b: Booking): Promise<Access> {
  if (can(u, "bookings.view")) return { level: "management", sensitive: can(u, "sensitive.view"), preciseLocation: true };
  if (u.roles.includes("family") && b.familyId && (await familyIdsOf(u.id)).includes(b.familyId)) return { level: "family", sensitive: true, preciseLocation: true };
  if (u.roles.includes("nanny") && b.nannyId) {
    const n = await nannyOf(u.id);
    if (n && n.id === b.nannyId && NANNY_VISIBLE.includes(b.status)) {
      const full = NANNY_FULL.includes(b.status);
      return { level: "nanny", sensitive: full, preciseLocation: full };
    }
  }
  return { level: "none", sensitive: false, preciseLocation: false };
}

function actorKind(u: CurrentUser | null): Actor {
  if (!u) return "system";
  return isManagement(u) ? "management" : u.roles.includes("nanny") ? "nanny" : "family";
}
function needPerm(u: CurrentUser, p: Permission) { if (!can(u, p)) throw new DomainError("You don't have permission to do that."); }
const isConflict = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23P01" || err?.cause?.code === "23P01";
};
export const newReference = () => `ON-${new Date().toISOString().slice(2, 7).replace("-", "")}-${randomToken(4).replace(/[^A-Za-z0-9]/g, "X").slice(0, 5).toUpperCase()}`;

async function managementRecipients(tx: Tx | typeof db = db) {
  const rows = await tx.select({ id: s.users.id, roles: sql<string[]>`array_agg(${s.userRoles.role})`, permissions: s.users.permissions, status: s.users.status })
    .from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
    .where(and(eq(s.users.status, "active"), inArray(s.userRoles.role, ["ops", "manager", "admin"]))).groupBy(s.users.id);
  return rows.filter((r) => can({ ...r, roles: r.roles as never }, "bookings.manage")).map((r) => r.id);
}
async function familyUserIds(familyId: string | null, tx: Tx | typeof db = db) {
  if (!familyId) return [];
  return (await tx.select({ id: s.familyMembers.userId }).from(s.familyMembers).where(eq(s.familyMembers.familyId, familyId))).map((r) => r.id);
}
async function nannyUserId(nannyId: string | null, tx: Tx | typeof db = db) {
  if (!nannyId) return null;
  const [n] = await tx.select({ u: s.nannies.userId }).from(s.nannies).where(eq(s.nannies.id, nannyId));
  return n?.u ?? null;
}
const dateRange = (b: Pick<Booking, "startDate" | "endDate">) => b.startDate === b.endDate ? fmtDate(b.startDate) : `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`;

// ---------------- Create ----------------
export type BookingRequestInput = {
  familyId: string; serviceCode: string; startDate: string; endDate: string; dailyStartMinute: number; dailyEndMinute: number;
  serviceLocationId: string | null; childIds: string[]; requestedNannyId: string | null; liveIn: boolean; overnight: boolean;
  needsDriver: boolean; requiredLanguages: string[]; specialistCare: boolean; budgetMaxMinor: number | null;
  specialRequests: string | null; idempotencyKey: string; termsAccepted: boolean;
};

export async function createBookingRequest(u: CurrentUser, i: BookingRequestInput): Promise<Booking> {
  if (!i.termsAccepted) throw new DomainError("Please accept the booking terms to continue.");
  const [existing] = await db.select().from(s.bookings).where(eq(s.bookings.idempotencyKey, i.idempotencyKey));
  if (existing) return existing; // double-submit / retry safe
  const [member] = await db.select().from(s.familyMembers).where(and(eq(s.familyMembers.userId, u.id), eq(s.familyMembers.familyId, i.familyId)));
  if (!member?.canBook) throw new DomainError("You are not authorised to book for this household.");
  const [fam] = await db.select().from(s.families).where(eq(s.families.id, i.familyId));
  if (fam.restricted) throw new DomainError("This account is restricted. Please contact Omega Nannies.");
  const today = new Date().toISOString().slice(0, 10);
  if (i.startDate < today) throw new DomainError("Start date must be in the future.");
  if (i.endDate < i.startDate) throw new DomainError("End date must be on or after the start date.");
  if (eachDate(i.startDate, i.endDate).length > 120) throw new DomainError("For bookings longer than 120 days please contact us for a bespoke arrangement.");
  const [svc] = await db.select().from(s.serviceCategories).where(and(eq(s.serviceCategories.code, i.serviceCode), eq(s.serviceCategories.active, true)));
  if (!svc) throw new DomainError("Unknown service.");
  if (i.childIds.length) {
    const kids = await db.select({ id: s.children.id }).from(s.children).where(and(eq(s.children.familyId, i.familyId), inArray(s.children.id, i.childIds)));
    if (kids.length !== i.childIds.length) throw new DomainError("Invalid child selection.");
  } else throw new DomainError("Please select at least one child.");
  if (i.serviceLocationId) {
    const [loc] = await db.select().from(s.serviceLocations).where(and(eq(s.serviceLocations.id, i.serviceLocationId), eq(s.serviceLocations.familyId, i.familyId)));
    if (!loc) throw new DomainError("Invalid location.");
  }
  const tz = "Africa/Johannesburg";
  const sessions = buildSessions({ ...i, timeZone: tz });
  try {
    return await db.transaction(async (tx) => {
      const [b] = await tx.insert(s.bookings).values({
        reference: newReference(), familyId: i.familyId, serviceCode: i.serviceCode, startDate: i.startDate, endDate: i.endDate,
        dailyStartMinute: i.dailyStartMinute, dailyEndMinute: i.dailyEndMinute, timeZone: tz, serviceLocationId: i.serviceLocationId,
        requestedNannyId: i.requestedNannyId, liveIn: i.liveIn, overnight: i.overnight, needsDriver: i.needsDriver,
        requiredLanguages: i.requiredLanguages, specialistCare: i.specialistCare, budgetMaxMinor: i.budgetMaxMinor,
        specialRequests: i.specialRequests, idempotencyKey: i.idempotencyKey, termsAcceptedAt: new Date(), termsVersion: "2026-10",
        createdBy: u.id, source: "portal", isDemo: u.isDemo,
      }).returning();
      await tx.insert(s.bookingChildren).values(i.childIds.map((childId) => ({ bookingId: b.id, childId })));
      await tx.insert(s.bookingSessions).values(sessions.map((x) => ({ bookingId: b.id, startsAt: x.startsAt, endsAt: x.endsAt })));
      await tx.insert(s.bookingEvents).values({ bookingId: b.id, toStatus: "enquiry", kind: "status", note: "Request submitted", actorId: u.id });
      await tx.insert(s.consents).values({ userId: u.id, policy: "booking_terms", version: "2026-10", granted: true });
      await notify(u.id, "booking_received", { ref: b.reference }, `booking:${b.id}:received`, `/family/bookings/${b.id}`, tx);
      await notifyMany(await managementRecipients(tx), "booking_new_enquiry", { ref: b.reference, family: fam.displayName, service: svc.name, dates: dateRange(b) }, `booking:${b.id}:new`, `/manage/bookings/${b.id}`, tx);
      await audit(u.id, "booking.create", "booking", b.id, { reference: b.reference }, tx);
      return b;
    });
  } catch (e) {
    const [dupe] = await db.select().from(s.bookings).where(eq(s.bookings.idempotencyKey, i.idempotencyKey));
    if (dupe) return dupe;
    throw e;
  }
}

// ---------------- Transitions ----------------
async function lockBooking(tx: Tx, id: string): Promise<Booking> {
  const r = await tx.execute(sql`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`);
  if (!r.rows.length) throw new DomainError("Booking not found");
  const [b] = await tx.select().from(s.bookings).where(eq(s.bookings.id, id));
  return b;
}

/** The only path that changes booking status. Validates the transition, updates holds atomically and logs history. */
export async function transitionTx(tx: Tx, bookingId: string, to: BookingStatus, u: CurrentUser | null, note?: string, data?: Record<string, unknown>): Promise<Booking> {
  const b = await lockBooking(tx, bookingId);
  const actor = actorKind(u);
  if (!canTransition(b.status, to, actor)) throw new DomainError(`A booking that is "${b.status.replace("_", " ")}" cannot move to "${to.replace("_", " ")}".`);
  const wasBlocking = BLOCKING.includes(b.status), willBlock = BLOCKING.includes(to);
  if (willBlock && !b.nannyId) throw new DomainError("Assign a nanny before holding or confirming this booking.");
  if (willBlock !== wasBlocking) {
    try {
      await tx.execute(sql`SAVEPOINT hold`);
      await tx.update(s.bookingSessions).set({ blocking: willBlock, nannyId: b.nannyId }).where(eq(s.bookingSessions.bookingId, b.id));
      await tx.execute(sql`RELEASE SAVEPOINT hold`);
    } catch (e) {
      if (isConflict(e)) throw new ConflictError("This nanny is no longer available for these dates — another booking was confirmed first.");
      throw e;
    }
  }
  const [nb] = await tx.update(s.bookings).set({ status: to, updatedAt: new Date(), lockVersion: b.lockVersion + 1 }).where(eq(s.bookings.id, b.id)).returning();
  await tx.insert(s.bookingEvents).values({ bookingId: b.id, fromStatus: b.status, toStatus: to, kind: "status", note: note ?? null, data: data ?? null, actorId: u?.id ?? null });
  await audit(u?.id ?? null, `booking.status.${to}`, "booking", b.id, { from: b.status }, tx);
  return nb;
}

export async function transition(u: CurrentUser, bookingId: string, to: BookingStatus, note?: string) {
  const [b0] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  if (!b0) throw new DomainError("Booking not found");
  const acc = await bookingAccess(u, b0);
  if (acc.level === "none") throw new DomainError("Booking not found");
  if (acc.level === "management") needPerm(u, "bookings.manage");
  return db.transaction(async (tx) => {
    const b = await transitionTx(tx, bookingId, to, u, note);
    const fam = await familyUserIds(b.familyId, tx);
    const nannyU = await nannyUserId(b.nannyId, tx);
    if (to === "declined") await notifyMany(fam, "booking_declined", { ref: b.reference, note: note ?? "" }, `booking:${b.id}:declined`, `/family/bookings/${b.id}`, tx);
    if (to === "cancelled") await notifyMany([...fam, ...(nannyU && BLOCKING.includes(b0.status) ? [nannyU] : [])], "booking_cancelled", { ref: b.reference, note: note ?? "" }, `booking:${b.id}:cancelled`, `/family/bookings/${b.id}`, tx);
    if (to === "completed") {
      const [n] = b.nannyId ? await tx.select().from(s.nannies).where(eq(s.nannies.id, b.nannyId)) : [];
      await notifyMany(fam, "booking_completed", { ref: b.reference, nanny: n?.displayName ?? "your nanny" }, `booking:${b.id}:completed`, `/family/bookings/${b.id}#review`, tx);
    }
    return b;
  });
}

// ---------------- Matching & assignment ----------------
export async function loadCandidates(b: Booking): Promise<Candidate[]> {
  const sess = await db.select().from(s.bookingSessions).where(eq(s.bookingSessions.bookingId, b.id));
  const minStart = new Date(Math.min(...sess.map((x) => x.startsAt.getTime())));
  const maxEnd = new Date(Math.max(...sess.map((x) => x.endsAt.getTime())));
  const nannies = await db.select().from(s.nannies).where(and(eq(s.nannies.status, "approved"), eq(s.nannies.isDemo, b.isDemo)));
  if (!nannies.length) return [];
  const ids = nannies.map((n) => n.id);
  const checks = await db.select().from(s.verificationChecks).where(inArray(s.verificationChecks.nannyId, ids));
  const busy = await db.select({ nannyId: s.bookingSessions.nannyId, startsAt: s.bookingSessions.startsAt, endsAt: s.bookingSessions.endsAt, ref: s.bookings.reference })
    .from(s.bookingSessions).innerJoin(s.bookings, eq(s.bookings.id, s.bookingSessions.bookingId))
    .where(and(eq(s.bookingSessions.blocking, true), inArray(s.bookingSessions.nannyId, ids), ne(s.bookingSessions.bookingId, b.id), lt(s.bookingSessions.startsAt, maxEnd), gt(s.bookingSessions.endsAt, minStart)));
  const exc = await db.select().from(s.availabilityExceptions).where(and(inArray(s.availabilityExceptions.nannyId, ids), lt(s.availabilityExceptions.startsAt, maxEnd), gt(s.availabilityExceptions.endsAt, minStart)));
  const rules = await db.select().from(s.availabilityRules).where(inArray(s.availabilityRules.nannyId, ids));
  const prev = b.familyId ? await db.select({ nannyId: s.bookings.nannyId, c: sql<number>`count(*)::int` }).from(s.bookings)
    .where(and(eq(s.bookings.familyId, b.familyId), eq(s.bookings.status, "completed"))).groupBy(s.bookings.nannyId) : [];
  const overlaps = (a: { startsAt: Date; endsAt: Date }) => sess.some((x) => x.startsAt < a.endsAt && x.endsAt > a.startsAt);
  return nannies.map((n) => {
    const myRules = rules.filter((r) => r.nannyId === n.id);
    const outside = myRules.length ? eachDate(b.startDate, b.endDate).filter((d) => !myRules.some((r) => r.weekday === weekday(d) && r.startMinute <= b.dailyStartMinute && (b.liveIn || r.endMinute >= b.dailyEndMinute))) : [];
    return {
      id: n.id, displayName: n.displayName, status: n.status, published: n.published, services: n.services, languages: n.languages, ageGroups: n.ageGroups,
      areas: n.areas, canDrive: n.canDrive, yearsExperience: n.yearsExperience, specialistExperience: n.specialistExperience, skills: n.skills,
      checks: checks.filter((c) => c.nannyId === n.id).map((c) => ({ kind: c.kind, status: c.status, expiresOn: c.expiresOn })),
      conflicts: [
        ...busy.filter((x) => x.nannyId === n.id && overlaps(x)).map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt, reason: `booked on ${x.ref}` })),
        ...exc.filter((x) => x.nannyId === n.id && x.kind !== "available" && overlaps(x)).map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt, reason: `${x.kind}${x.reason ? ` (${x.reason})` : ""}` })),
      ],
      outsideAvailability: outside,
      previousBookingsWithFamily: prev.find((p) => p.nannyId === n.id)?.c ?? 0,
    };
  });
}

export async function requirementsFor(b: Booking): Promise<MatchRequirements> {
  const kids = await db.select({ dob: s.children.dateOfBirth }).from(s.bookingChildren).innerJoin(s.children, eq(s.children.id, s.bookingChildren.childId)).where(eq(s.bookingChildren.bookingId, b.id));
  const ages = [...new Set(kids.map((k) => ageFrom(k.dob)).filter((a): a is number => a !== null).map(ageGroup))];
  let area = b.areaText;
  if (b.serviceLocationId) { const [l] = await db.select().from(s.serviceLocations).where(eq(s.serviceLocations.id, b.serviceLocationId)); area = l?.area ?? area; }
  return { serviceCode: b.serviceCode, ageGroups: ages, requiredLanguages: b.requiredLanguages, needsDriver: b.needsDriver, specialist: b.specialistCare, area, requestedNannyId: b.requestedNannyId, budgetMaxMinor: b.budgetMaxMinor, estimatedTotalMinor: null };
}

export async function runMatching(u: CurrentUser, bookingId: string) {
  needPerm(u, "bookings.manage");
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  const results = rank(await loadCandidates(b), await requirementsFor(b));
  await db.transaction(async (tx) => {
    await tx.delete(s.matchResults).where(eq(s.matchResults.bookingId, b.id));
    if (results.length) await tx.insert(s.matchResults).values(results.map((r) => ({ bookingId: b.id, nannyId: r.nannyId, eligible: r.eligible, score: r.score, reasons: r.reasons })));
    if (b.status === "enquiry") await transitionTx(tx, b.id, "matching", u, "Matching started");
  });
  return results;
}

export async function assignNanny(u: CurrentUser, bookingId: string, nannyId: string, overrideReason?: string) {
  needPerm(u, "bookings.manage");
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  if (!b) throw new DomainError("Booking not found");
  if (["completed", "cancelled", "declined", "refunded", "refund_pending"].includes(b.status)) throw new DomainError("This booking can no longer be reassigned.");
  const result = rank((await loadCandidates(b)).filter((c) => c.id === nannyId), await requirementsFor(b))[0];
  if (!result) throw new DomainError("Nanny is not approved for placements.");
  if (!result.eligible && !overrideReason?.trim()) throw new DomainError("This nanny fails a hard requirement. Record an override reason to assign anyway.");
  await db.transaction(async (tx) => {
    await lockBooking(tx, b.id);
    try {
      await tx.execute(sql`SAVEPOINT assign`);
      await tx.update(s.bookingSessions).set({ nannyId }).where(eq(s.bookingSessions.bookingId, b.id));
      await tx.execute(sql`RELEASE SAVEPOINT assign`);
    } catch (e) {
      if (isConflict(e)) throw new ConflictError("That nanny already has a confirmed booking overlapping these dates.");
      throw e;
    }
    await tx.update(s.bookings).set({ nannyId, updatedAt: new Date() }).where(eq(s.bookings.id, b.id));
    await tx.insert(s.bookingEvents).values({ bookingId: b.id, kind: result.eligible ? "assignment" : "match_override", note: overrideReason ?? `Assigned ${result.displayName} (score ${result.score})`, data: { nannyId, score: result.score, eligible: result.eligible }, internal: true, actorId: u.id });
    await audit(u.id, result.eligible ? "booking.assign" : "booking.assign_override", "booking", b.id, { nannyId, reason: overrideReason }, tx);
  });
}

// ---------------- Quotations ----------------
export async function publishedPriceBook(at = new Date()) {
  const [pb] = await db.select().from(s.priceBooks).where(and(eq(s.priceBooks.status, "published"), or(sql`${s.priceBooks.effectiveFrom} IS NULL`, lt(s.priceBooks.effectiveFrom, at)))).orderBy(desc(s.priceBooks.version)).limit(1);
  if (!pb) return null;
  const items = await db.select().from(s.priceItems).where(eq(s.priceItems.priceBookId, pb.id));
  return { book: pb, items: items as PriceItem[] };
}

export async function priceBooking(b: Booking, travelTrips = 0) {
  const pb = await publishedPriceBook();
  if (!pb) throw new DomainError("No published price book. Publish pricing in Pricing administration first.");
  const [fam] = b.familyId ? await db.select().from(s.families).where(eq(s.families.id, b.familyId)) : [];
  const hol = await db.select().from(s.publicHolidays).where(and(sql`${s.publicHolidays.day} >= ${b.startDate}`, sql`${s.publicHolidays.day} <= ${b.endDate}`));
  const result = calculateQuote(pb.items, {
    audience: fam?.audience ?? "visiting", serviceCode: b.serviceCode, dates: eachDate(b.startDate, b.endDate), dailyStartMinute: b.dailyStartMinute,
    dailyEndMinute: b.dailyEndMinute, liveIn: b.liveIn, overnight: b.overnight, specialist: b.specialistCare, travelTrips, publicHolidays: new Set(hol.map((h) => h.day)),
  }, pb.book.currency);
  return { ...result, priceBookId: pb.book.id, version: pb.book.version };
}

export async function createQuotation(u: CurrentUser, bookingId: string, opts: { adjustmentMinor: number; adjustmentReason: string | null; travelTrips: number; validDays: number }) {
  needPerm(u, "bookings.manage");
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  if (!b) throw new DomainError("Booking not found");
  if (!["matching", "introduction", "quotation", "awaiting_approval"].includes(b.status)) throw new DomainError("Quotations can only be prepared before acceptance.");
  if (opts.adjustmentMinor !== 0 && !opts.adjustmentReason?.trim()) throw new DomainError("Give a reason for the price adjustment.");
  const priced = await priceBooking(b, opts.travelTrips);
  const total = priced.subtotalMinor + opts.adjustmentMinor;
  if (total < 0) throw new DomainError("Total cannot be negative.");
  const deposit = Math.min(total, priced.subtotalMinor ? Math.round((priced.depositMinor * total) / priced.subtotalMinor) : total);
  return db.transaction(async (tx) => {
    await lockBooking(tx, b.id);
    const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${s.quotations.version}),0)::int` }).from(s.quotations).where(eq(s.quotations.bookingId, b.id));
    await tx.update(s.quotations).set({ status: "superseded" }).where(and(eq(s.quotations.bookingId, b.id), inArray(s.quotations.status, ["draft", "sent"])));
    const [q] = await tx.insert(s.quotations).values({
      bookingId: b.id, version: v + 1, priceBookId: priced.priceBookId, currency: priced.currency, lines: priced.lines, subtotalMinor: priced.subtotalMinor,
      adjustmentMinor: opts.adjustmentMinor, adjustmentReason: opts.adjustmentReason, totalMinor: total, depositMinor: deposit,
      validUntil: new Date(Date.now() + opts.validDays * 86400_000), createdBy: u.id,
    }).returning();
    await tx.insert(s.bookingEvents).values({ bookingId: b.id, kind: "quote", note: `Quotation v${q.version} drafted: ${formatMoney(total)}`, internal: true, actorId: u.id, data: { assumptions: priced.assumptions } });
    if (b.status === "awaiting_approval") await transitionTx(tx, b.id, "quotation", u, "Quotation revised");
    else if (b.status !== "quotation") await transitionTx(tx, b.id, "quotation", u, "Quotation in preparation");
    return q;
  });
}

export async function sendQuotation(u: CurrentUser, quotationId: string) {
  needPerm(u, "bookings.manage");
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(s.quotations).where(eq(s.quotations.id, quotationId));
    if (!q || q.status !== "draft") throw new DomainError("Only draft quotations can be sent.");
    const [b0] = await tx.select().from(s.bookings).where(eq(s.bookings.id, q.bookingId));
    if (!b0.nannyId) throw new DomainError("Assign a nanny before sending the quotation.");
    await tx.update(s.quotations).set({ status: "sent", sentAt: new Date() }).where(eq(s.quotations.id, q.id));
    const b = await transitionTx(tx, q.bookingId, "awaiting_approval", u, `Quotation v${q.version} sent`);
    await notifyMany(await familyUserIds(b.familyId, tx), "quote_ready", { ref: b.reference, total: formatMoney(q.totalMinor, q.currency), deposit: formatMoney(q.depositMinor, q.currency) }, `quote:${q.id}:sent`, `/family/bookings/${b.id}`, tx);
  });
}

/** Family accepts: places a hold on the nanny's time (conflict-safe) and raises invoices. Does not confirm. */
export async function acceptQuotation(u: CurrentUser, quotationId: string, termsAccepted: boolean) {
  if (!termsAccepted) throw new DomainError("Please accept the booking terms.");
  const [q] = await db.select().from(s.quotations).where(eq(s.quotations.id, quotationId));
  if (!q) throw new DomainError("Quotation not found");
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, q.bookingId));
  const acc = await bookingAccess(u, b);
  if (acc.level !== "family") throw new DomainError("Quotation not found");
  const [m] = await db.select().from(s.familyMembers).where(and(eq(s.familyMembers.userId, u.id), eq(s.familyMembers.familyId, b.familyId!)));
  if (!m?.canPay) throw new DomainError("Only household members with payment authority can accept quotations.");
  if (q.status === "accepted") return q;
  if (q.status !== "sent") throw new DomainError("This quotation is no longer available. Please check for a newer version.");
  if (q.validUntil && q.validUntil < new Date()) throw new DomainError("This quotation has expired. We'll send you an updated one.");
  return db.transaction(async (tx) => {
    const [aq] = await tx.update(s.quotations).set({ status: "accepted", acceptedAt: new Date(), acceptedBy: u.id }).where(and(eq(s.quotations.id, q.id), eq(s.quotations.status, "sent"))).returning();
    if (!aq) throw new DomainError("This quotation was just updated. Please refresh.");
    await tx.update(s.bookings).set({ acceptedQuotationId: q.id }).where(eq(s.bookings.id, b.id));
    const invoiceNo = (k: string) => `${b.reference}-${k}${q.version}`;
    const inv = [{ number: invoiceNo(q.depositMinor < q.totalMinor ? "D" : "F"), bookingId: b.id, quotationId: q.id, kind: q.depositMinor < q.totalMinor ? "deposit" : "full", currency: q.currency, amountMinor: q.depositMinor, dueAt: new Date(Date.now() + 2 * 86400_000) }];
    if (q.depositMinor < q.totalMinor) inv.push({ number: invoiceNo("B"), bookingId: b.id, quotationId: q.id, kind: "balance", currency: q.currency, amountMinor: q.totalMinor - q.depositMinor, dueAt: zonedStart(b) });
    await tx.insert(s.invoices).values(inv.filter((x) => x.amountMinor > 0)).onConflictDoNothing();
    await tx.insert(s.consents).values({ userId: u.id, policy: "quotation_terms", version: `${q.id}:v${q.version}`, granted: true });
    await transitionTx(tx, b.id, "awaiting_payment", u, `Quotation v${q.version} accepted`);
    if (q.depositMinor === 0) await transitionTx(tx, b.id, "confirmed", null, "No payment required to confirm");
    return aq;
  });
}
const zonedStart = (b: Booking) => new Date(b.startDate + "T00:00:00Z");

// ---------------- Confirmation side effects (called by payment service) ----------------
export async function onBookingConfirmed(tx: Tx, b: Booking) {
  const nannyU = await nannyUserId(b.nannyId, tx);
  if (nannyU) await notify(nannyU, "booking_confirmed_nanny", { ref: b.reference, dates: dateRange(b) }, `booking:${b.id}:confirmed:nanny`, `/nanny/bookings/${b.id}`, tx);
  // Booking conversation between family, nanny and management, created once.
  const [conv] = await tx.select().from(s.conversations).where(and(eq(s.conversations.bookingId, b.id), eq(s.conversations.kind, "booking")));
  if (!conv && nannyU) {
    const [c] = await tx.insert(s.conversations).values({ kind: "booking", bookingId: b.id, familyId: b.familyId, nannyId: b.nannyId, subject: `Booking ${b.reference}` }).returning();
    const parts = [...(await familyUserIds(b.familyId, tx)), nannyU];
    await tx.insert(s.conversationParticipants).values([...new Set(parts)].map((userId) => ({ conversationId: c.id, userId }))).onConflictDoNothing();
  }
}

// ---------------- Reschedule / cancel / complete ----------------
export async function reschedule(u: CurrentUser, bookingId: string, i: { startDate: string; endDate: string; dailyStartMinute: number; dailyEndMinute: number; reason: string }) {
  needPerm(u, "bookings.manage");
  if (!i.reason.trim()) throw new DomainError("Give a reason for rescheduling.");
  if (i.endDate < i.startDate) throw new DomainError("End date must be on or after the start date.");
  return db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (["completed", "cancelled", "declined", "refunded", "in_progress"].includes(b.status)) throw new DomainError("This booking can't be rescheduled.");
    const blocking = BLOCKING.includes(b.status);
    const sessions = buildSessions({ ...i, timeZone: b.timeZone, liveIn: b.liveIn });
    await tx.delete(s.bookingSessions).where(eq(s.bookingSessions.bookingId, b.id));
    try {
      await tx.execute(sql`SAVEPOINT resched`);
      await tx.insert(s.bookingSessions).values(sessions.map((x) => ({ bookingId: b.id, nannyId: b.nannyId, startsAt: x.startsAt, endsAt: x.endsAt, blocking })));
      await tx.execute(sql`RELEASE SAVEPOINT resched`);
    } catch (e) {
      if (isConflict(e)) throw new ConflictError("The assigned nanny is not free on the new dates.");
      throw e;
    }
    const [nb] = await tx.update(s.bookings).set({ startDate: i.startDate, endDate: i.endDate, dailyStartMinute: i.dailyStartMinute, dailyEndMinute: i.dailyEndMinute, updatedAt: new Date() }).where(eq(s.bookings.id, b.id)).returning();
    const priceNote = b.acceptedQuotationId ? " The accepted quotation is unchanged; issue a revised quotation if the price must change." : "";
    await tx.insert(s.bookingEvents).values({ bookingId: b.id, kind: "rescheduled", note: `${i.reason}.${priceNote}`, data: { from: { s: b.startDate, e: b.endDate }, to: { s: i.startDate, e: i.endDate } }, actorId: u.id });
    await audit(u.id, "booking.reschedule", "booking", b.id, { reason: i.reason }, tx);
    const nannyU = blocking ? await nannyUserId(b.nannyId, tx) : null;
    await notifyMany([...(await familyUserIds(b.familyId, tx)), ...(nannyU ? [nannyU] : [])], "booking_rescheduled", { ref: b.reference, dates: dateRange(nb) }, `booking:${b.id}:resched:${nb.lockVersion}:${i.startDate}`, undefined, tx);
    return nb;
  });
}

export async function addNote(u: CurrentUser, bookingId: string, note: string, internal: boolean) {
  needPerm(u, "bookings.manage");
  await db.insert(s.bookingEvents).values({ bookingId, kind: "note", note, internal, actorId: u.id });
}
