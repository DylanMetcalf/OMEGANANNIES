"use server";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser } from "@/lib/auth";
import { createBookingRequest, DomainError, familyIdsOf } from "@/lib/bookings";
import { bool, list, opt, run, str } from "@/lib/forms";
import { availabilityFor, clearDraft, getDraft, saveDraft, shortlistOf } from "@/lib/journey";
import { orderPreferences, parseReq, reqToParams, validateReq, FILTER_KEYS } from "@/lib/journey-core";
import { deliverPending } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import { hhmmToMinutes } from "@/lib/time";
import type { ActionResult } from "@/components/action-form";

async function familyUser() {
  const u = await assertUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  if (!familyId) throw new DomainError("No household is linked to your account.");
  return { u, familyId };
}
const today = () => new Date().toISOString().slice(0, 10);
const formObject = (fd: FormData) => {
  const o: Record<string, unknown> = {};
  for (const k of new Set(fd.keys())) { const v = fd.getAll(k).map(String); o[k] = v.length > 1 ? v : v[0]; }
  return o;
};

/** Step 1: validate requirements, store the draft server-side, continue to discovery (or just save). */
export async function saveRequirementsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let to = "";
  const r = await run(async () => {
    const { u, familyId } = await familyUser();
    const req = parseReq(formObject(fd));
    const kids = await db.select({ id: s.children.id }).from(s.children).where(eq(s.children.familyId, familyId));
    req.kids = req.kids.filter((k) => kids.some((c) => c.id === k)); // only this household's children
    if (str(fd, "intent") === "save") {
      await saveDraft(familyId, u.id, { req, step: "requirements" });
      return { ok: "Saved — you can continue any time from Home or the Book button." };
    }
    const errors = validateReq(req, today(), kids.length > 0);
    if (Object.keys(errors).length) return { error: "Please check the highlighted details.", fieldErrors: errors as Record<string, string> };
    await saveDraft(familyId, u.id, { req, step: "discover" });
    to = `/family/book/nannies?${reqToParams(req)}`;
    return { ok: "Finding nannies for you…" };
  });
  if (to) redirect(to);
  return r;
}

/** Shortlist toggle used by cards, drawers and profiles. Returns the new state so the button can confirm it. */
export async function toggleShortlistAction(nannyId: string): Promise<{ saved: boolean; count: number } | { error: string }> {
  try {
    const { u, familyId } = await familyUser();
    if (!/^[0-9a-f-]{36}$/.test(nannyId)) return { error: "Not found" };
    if (!(await rateLimit(`shortlist:${u.id}`, 120, 300))) return { error: "Please slow down a little." };
    const [n] = await db.select({ id: s.nannies.id }).from(s.nannies).where(and(eq(s.nannies.id, nannyId), eq(s.nannies.status, "approved"), eq(s.nannies.published, true)));
    if (!n) return { error: "This profile is no longer available." };
    const del = await db.delete(s.favourites).where(and(eq(s.favourites.familyId, familyId), eq(s.favourites.nannyId, nannyId))).returning();
    if (!del.length) await db.insert(s.favourites).values({ familyId, nannyId }).onConflictDoNothing();
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(s.favourites).where(eq(s.favourites.familyId, familyId));
    revalidatePath("/family", "layout");
    return { saved: !del.length, count: c };
  } catch { return { error: "Couldn't update your shortlist. Please try again." }; }
}

/** "Select this nanny": shortlist + make them first preference, then go to review. */
export async function selectNannyAction(fd: FormData) {
  const { u, familyId } = await familyUser();
  const nannyId = str(fd, "nannyId");
  const [n] = await db.select({ id: s.nannies.id }).from(s.nannies).where(and(eq(s.nannies.id, nannyId), eq(s.nannies.status, "approved"), eq(s.nannies.published, true)));
  if (!n) throw new DomainError("This profile is no longer available.");
  await db.insert(s.favourites).values({ familyId, nannyId }).onConflictDoNothing();
  const d = await getDraft(familyId);
  await saveDraft(familyId, u.id, { prefs: [nannyId, ...d.prefs.filter((p) => p !== nannyId)].slice(0, 3), assistance: false, step: "review" });
  redirect("/family/book/review");
}

export async function saveSearchAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const name = str(fd, "name").trim().slice(0, 60) || "My search";
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(s.savedSearches).where(eq(s.savedSearches.familyId, familyId));
    if (c >= 20) throw new DomainError("You have 20 saved searches. Remove one first.");
    const src = formObject(fd);
    const req = parseReq(src);
    const filters = Object.fromEntries(FILTER_KEYS.filter((k) => typeof src[k] === "string" && src[k]).map((k) => [k, String(src[k]).slice(0, 80)]));
    await db.insert(s.savedSearches).values({ familyId, userId: u.id, name, params: { req: Object.fromEntries(reqToParams(req)), filters } });
    revalidatePath("/family/book/nannies");
    return { ok: `Saved “${name}”.` };
  });
}
export async function deleteSavedSearchAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { familyId } = await familyUser();
    await db.delete(s.savedSearches).where(and(eq(s.savedSearches.id, str(fd, "id")), eq(s.savedSearches.familyId, familyId)));
    revalidatePath("/family/book/nannies");
    return { ok: "Removed." };
  });
}

/** Store preference order / assistance choice without submitting (used when leaving the review step). */
export async function savePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const prefs = orderPreferences(list(fd, "prefs"), await shortlistOf(familyId));
    await saveDraft(familyId, u.id, { prefs, assistance: bool(fd, "assistance"), step: "review" });
    return { ok: "Saved." };
  });
}

/**
 * Step 5: submit. Requirements come from the server-side draft (not the browser); preferences are re-validated
 * against this family's shortlist and published profiles; availability is re-checked. Creates a request, never a
 * confirmed booking, and never charges anything.
 */
export async function submitJourneyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let to = "";
  const r = await run(async () => {
    const { u, familyId } = await familyUser();
    const d = await getDraft(familyId);
    const req = d.req;
    const kids = await db.select({ id: s.children.id }).from(s.children).where(eq(s.children.familyId, familyId));
    const errors = validateReq(req, today(), true);
    if (!kids.length) throw new DomainError("Add your children in My Family first — we need their ages to match the right nanny.");
    if (Object.keys(errors).length) throw new DomainError(`Please review your requirements: ${Object.values(errors)[0]}`);
    const shortlist = await shortlistOf(familyId);
    const prefs = orderPreferences(list(fd, "prefs"), shortlist);
    const valid = prefs.length ? (await db.select({ id: s.nannies.id }).from(s.nannies).where(and(inArray(s.nannies.id, prefs), eq(s.nannies.status, "approved"), eq(s.nannies.published, true)))).map((x) => x.id) : [];
    const ordered = prefs.filter((p) => valid.includes(p));
    const assistance = bool(fd, "assistance") || !ordered.length;
    if (ordered.length && !bool(fd, "assistance")) {
      const av = await availabilityFor(ordered, req);
      if (ordered.every((id) => av[id] === "unavailable")) throw new DomainError("None of your chosen nannies is free on these dates. Choose another nanny, or tick “Ask Omega to suggest someone”.");
    }
    const loc = opt(fd, "serviceLocationId");
    const liveIn = req.service === "live_in";
    const b = await createBookingRequest(u, {
      familyId, serviceCode: req.service, startDate: req.start, endDate: req.end || req.start,
      dailyStartMinute: liveIn ? 480 : hhmmToMinutes(req.t1), dailyEndMinute: liveIn ? 480 : hhmmToMinutes(req.t2),
      serviceLocationId: loc, childIds: req.kids.length ? req.kids : kids.map((k) => k.id), requestedNannyId: ordered[0] ?? null, liveIn,
      overnight: req.service === "night", needsDriver: req.driver, requiredLanguages: req.langs, specialistCare: req.specialist, budgetMaxMinor: null,
      specialRequests: [req.notes, opt(fd, "notes")].filter(Boolean).join("\n").slice(0, 2000) || null,
      idempotencyKey: d.key, termsAccepted: bool(fd, "terms"), weekdays: req.recurring ? req.weekdays : null,
      preferredNannyIds: ordered, assistanceRequested: assistance, areaText: req.area || null,
    });
    if (ordered.length) {
      const names = await db.select({ id: s.nannies.id, n: s.nannies.displayName }).from(s.nannies).where(inArray(s.nannies.id, ordered));
      await db.insert(s.bookingEvents).values({ bookingId: b.id, kind: "note", note: `Family preferences: ${ordered.map((id, i) => `${i + 1}. ${names.find((x) => x.id === id)?.n}`).join(" · ")}`, actorId: u.id });
    }
    if (assistance) {
      await db.insert(s.tasks).values({ title: `Help choose a nanny — ${b.reference}`, notes: `The family asked Omega to suggest a nanny${ordered.length ? " (they also listed preferences)" : ""}. Review requirements and run matching.`, priority: "high", bookingId: b.id, familyId }).onConflictDoNothing();
    }
    await audit(u.id, "booking.journey_submit", "booking", b.id, { prefs: ordered.length, assistance });
    await clearDraft(familyId);
    void deliverPending();
    to = `/family/bookings/${b.id}?new=1`;
    return { ok: "Request sent" };
  });
  if (to) redirect(to);
  return r;
}

export async function startOverAction() {
  const { u, familyId } = await familyUser();
  await saveDraft(familyId, u.id, { req: parseReq({}), prefs: [], assistance: false, key: randomUUID(), step: "requirements" });
  redirect("/family/book");
}

/** Families can report a published review (e.g. it identifies a child); moderation decides. */
export async function reportReviewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u } = await familyUser();
    const reason = str(fd, "reason").trim().slice(0, 500);
    if (reason.length < 5) throw new DomainError("Tell us briefly what is wrong with this review.");
    const r = await db.update(s.reviews).set({ reportedAt: new Date(), reportReason: reason, reportedBy: u.id }).where(and(eq(s.reviews.id, str(fd, "reviewId")), eq(s.reviews.status, "published"))).returning({ id: s.reviews.id });
    if (!r.length) throw new DomainError("Review not found.");
    await audit(u.id, "review.report", "review", r[0].id, undefined);
    return { ok: "Thank you — our team will review it." };
  });
}
