"use server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser } from "@/lib/auth";
import { DomainError, nannyOf, respondToOffer, transition } from "@/lib/bookings";
import { list, opt, run, str } from "@/lib/forms";
import { deliverPending } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import { storeDocumentUpload, storeImageUpload } from "@/lib/uploads";
import { provenanceEntry, submitForReview } from "@/lib/onboarding";
import { hhmmToMinutes, zonedToUtc } from "@/lib/time";
import type { ActionResult } from "@/components/action-form";

async function me() {
  const u = await assertUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) throw new DomainError("Your nanny profile isn't linked yet. Please contact Omega.");
  return { u, n };
}

export async function bookingStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u } = await me();
    const to = z.enum(["in_progress", "completed"]).parse(str(fd, "to"));
    await transition(u, str(fd, "bookingId"), to, to === "in_progress" ? "Nanny checked in" : opt(fd, "note") ?? "Nanny marked care complete");
    void deliverPending();
    revalidatePath(`/nanny/bookings/${str(fd, "bookingId")}`);
    return { ok: to === "in_progress" ? "Checked in — have a wonderful day." : "Marked complete. Thank you!" };
  });
}

/** Opt-in, time-limited location sharing. Only for confirmed/in-progress bookings on their dates. */
export async function startShareAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const minutes = z.coerce.number().int().refine((m) => [30, 60, 120, 240].includes(m)).parse(str(fd, "minutes"));
    const [b] = await db.select().from(s.bookings).where(and(eq(s.bookings.id, str(fd, "bookingId")), eq(s.bookings.nannyId, n.id)));
    if (!b || !["confirmed", "in_progress"].includes(b.status)) throw new DomainError("Location sharing is only available during a confirmed booking.");
    const today = new Date().toISOString().slice(0, 10);
    if (today < b.startDate || today > b.endDate) throw new DomainError("Location sharing is available on booking dates only.");
    await db.update(s.locationShares).set({ revokedAt: new Date(), lat: null, lng: null }).where(and(eq(s.locationShares.bookingId, b.id), isNull(s.locationShares.revokedAt)));
    await db.insert(s.locationShares).values({ bookingId: b.id, sharerId: u.id, expiresAt: new Date(Date.now() + minutes * 60_000) });
    await db.insert(s.consents).values({ userId: u.id, policy: "location", version: `booking:${b.id}`, granted: true });
    await audit(u.id, "location.share_start", "booking", b.id, { minutes });
    revalidatePath(`/nanny/bookings/${b.id}`);
    return { ok: `Sharing for ${minutes} minutes. Keep this page open to send updates.` };
  });
}
export async function stopShareAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u } = await me();
    await db.update(s.locationShares).set({ revokedAt: new Date(), lat: null, lng: null, accuracyM: null }).where(and(eq(s.locationShares.bookingId, str(fd, "bookingId")), eq(s.locationShares.sharerId, u.id), isNull(s.locationShares.revokedAt)));
    await audit(u.id, "location.share_stop", "booking", str(fd, "bookingId"));
    revalidatePath(`/nanny/bookings/${str(fd, "bookingId")}`);
    return { ok: "Location sharing stopped and your last location deleted." };
  });
}
export async function pushLocationAction(bookingId: string, lat: number, lng: number, accuracy: number) {
  const u = await assertUser({ role: "nanny" });
  if (!(await rateLimit(`loc:${u.id}`, 6, 60))) return { error: "rate" };
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "bad" };
  const r = await db.update(s.locationShares).set({ lat: lat.toFixed(5), lng: lng.toFixed(5), accuracyM: Math.min(99999, Math.round(accuracy)), pointAt: new Date() })
    .where(and(eq(s.locationShares.bookingId, bookingId), eq(s.locationShares.sharerId, u.id), isNull(s.locationShares.revokedAt), gt(s.locationShares.expiresAt, new Date()))).returning();
  return r.length ? { ok: true } : { error: "inactive" };
}
export async function checkInNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const [b] = await db.select().from(s.bookings).where(and(eq(s.bookings.id, str(fd, "bookingId")), eq(s.bookings.nannyId, n.id)));
    if (!b || !["confirmed", "in_progress"].includes(b.status)) throw new DomainError("Check-ins are for active bookings.");
    const note = z.string().min(2).max(280).parse(str(fd, "note"));
    const [share] = await db.select().from(s.locationShares).where(and(eq(s.locationShares.bookingId, b.id), isNull(s.locationShares.revokedAt), gt(s.locationShares.expiresAt, new Date())));
    if (share) await db.update(s.locationShares).set({ checkInNote: note, pointAt: share.pointAt }).where(eq(s.locationShares.id, share.id));
    else await db.insert(s.locationShares).values({ bookingId: b.id, sharerId: u.id, expiresAt: new Date(Date.now() + 4 * 3600_000), checkInNote: note });
    await db.insert(s.bookingEvents).values({ bookingId: b.id, kind: "check_in", note, actorId: u.id });
    revalidatePath(`/nanny/bookings/${b.id}`);
    return { ok: "Check-in shared with the family." };
  });
}

// ---- Profile: self-service fields apply immediately; verification-related fields need management review ----
const SELF = ["headline", "bio", "skills", "languages"] as const;
const REVIEWED = ["services", "ageGroups", "areas", "canDrive", "specialistExperience", "yearsExperience"] as const;
export async function saveProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const next: Record<string, unknown> = {
      headline: z.string().max(140).parse(str(fd, "headline")), bio: z.string().max(3000).parse(str(fd, "bio")), skills: list(fd, "skills").slice(0, 20), languages: list(fd, "languages").slice(0, 10),
      services: list(fd, "services"), ageGroups: list(fd, "ageGroups"), areas: list(fd, "areas"), canDrive: str(fd, "canDrive") === "yes",
      specialistExperience: opt(fd, "specialistExperience")?.slice(0, 1000) ?? null, yearsExperience: z.coerce.number().int().min(0).max(60).parse(str(fd, "yearsExperience")),
    };
    const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
    const cur = n as unknown as Record<string, unknown>;
    let applied = 0, pending = 0;
    await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = {};
      for (const f of SELF) if (!same(cur[f], next[f])) { patch[f] = next[f]; applied++; await tx.insert(s.profileChangeRequests).values({ nannyId: n.id, field: f, oldValue: cur[f] as object, newValue: next[f] as object, status: "applied", autoApplied: true, requestedBy: u.id }); }
      const prov = { ...(n.provenance as Record<string, unknown>) };
      for (const k of Object.keys(patch)) prov[k] = provenanceEntry("nanny", u.id);
      if (applied) await tx.update(s.nannies).set({ ...patch, provenance: prov, updatedAt: new Date() }).where(eq(s.nannies.id, n.id));
      for (const f of REVIEWED) if (!same(cur[f], next[f])) {
        pending++;
        await tx.update(s.profileChangeRequests).set({ status: "superseded" }).where(and(eq(s.profileChangeRequests.nannyId, n.id), eq(s.profileChangeRequests.field, f), eq(s.profileChangeRequests.status, "pending")));
        await tx.insert(s.profileChangeRequests).values({ nannyId: n.id, field: f, oldValue: cur[f] as object, newValue: next[f] as object, requestedBy: u.id });
      }
      await audit(u.id, "nanny.profile_edit", "nanny", n.id, { applied, pending }, tx);
    });
    revalidatePath("/nanny/profile");
    return { ok: [applied && `${applied} change(s) published`, pending && `${pending} change(s) sent to Omega for review`].filter(Boolean).join(" · ") || "No changes." };
  });
}

export async function saveWeeklyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const rows: { nannyId: string; weekday: number; startMinute: number; endMinute: number }[] = [];
    for (let w = 0; w < 7; w++) {
      if (fd.get(`on-${w}`) !== "on") continue;
      const a = hhmmToMinutes(str(fd, `from-${w}`)), b = str(fd, `to-${w}`) === "24:00" ? 1439 : hhmmToMinutes(str(fd, `to-${w}`));
      if (b <= a) throw new DomainError("Each day's finish must be after its start.");
      rows.push({ nannyId: n.id, weekday: w, startMinute: a, endMinute: b });
    }
    await db.transaction(async (tx) => {
      await tx.delete(s.availabilityRules).where(eq(s.availabilityRules.nannyId, n.id));
      if (rows.length) await tx.insert(s.availabilityRules).values(rows);
    });
    await audit(u.id, "availability.weekly_update", "nanny", n.id, { days: rows.length });
    revalidatePath("/nanny/availability");
    return { ok: "Weekly availability saved." };
  });
}
export async function addExceptionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "from")), to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "to") || from);
    if (to < from) throw new DomainError("End date must be after start date.");
    await db.insert(s.availabilityExceptions).values({ nannyId: n.id, startsAt: zonedToUtc(from, 0, "Africa/Johannesburg"), endsAt: zonedToUtc(to, 1440, "Africa/Johannesburg"), kind: z.enum(["unavailable", "leave", "available"]).parse(str(fd, "kind")), reason: opt(fd, "reason")?.slice(0, 200), createdBy: u.id });
    revalidatePath("/nanny/availability");
    return { ok: "Added." };
  });
}
export async function removeExceptionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { n } = await me();
    await db.delete(s.availabilityExceptions).where(and(eq(s.availabilityExceptions.id, str(fd, "id")), eq(s.availabilityExceptions.nannyId, n.id)));
    revalidatePath("/nanny/availability");
    return { ok: "Removed." };
  });
}

export async function uploadDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    if (!(await rateLimit(`upload:${u.id}`, 10, 3600))) throw new DomainError("Upload limit reached. Try again later.");
    const docType = z.enum(["id_document", "police_clearance", "first_aid", "reference", "qualification", "other"]).parse(str(fd, "docType"));
    const expiresOn = opt(fd, "expiresOn");
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new DomainError("Enter a valid expiry date.");
    const f = await storeDocumentUpload(fd.get("file"));
    const [d] = await db.insert(s.documents).values({ ownerNannyId: n.id, docType, fileName: f.fileName, mimeType: f.mime, sizeBytes: f.size, storageKey: f.key, sha256: f.sha256, scanStatus: f.scan, expiresOn, uploadedBy: u.id }).returning();
    await audit(u.id, "document.upload", "document", d.id, { docType, scan: f.scan });
    revalidatePath("/nanny/documents"); revalidatePath("/nanny/onboarding");
    return { ok: "Uploaded. Omega will review it — uploading doesn’t count as verification until it’s approved." };
  });
}
/** Nannies may withdraw a document only while it is still awaiting review; reviewed documents are retained. */
export async function withdrawDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const r = await db.delete(s.documents).where(and(eq(s.documents.id, str(fd, "documentId")), eq(s.documents.ownerNannyId, n.id), eq(s.documents.status, "pending_review"))).returning();
    if (!r.length) throw new DomainError("Only documents awaiting review can be withdrawn.");
    await audit(u.id, "document.withdraw", "document", r[0].id);
    revalidatePath("/nanny/documents");
    return { ok: "Document withdrawn." };
  });
}
export async function photoChangeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    if (!(await rateLimit(`photo:${u.id}`, 5, 3600))) throw new DomainError("Upload limit reached. Try again later.");
    const { key } = await storeImageUpload(fd.get("file"));
    if (!n.photoKey && n.status !== "approved") {
      // First photo during onboarding applies straight away; Omega still reviews the profile before approval.
      await db.update(s.nannies).set({ photoKey: key, photoUrl: `/api/photos/${n.id}`, provenance: { ...(n.provenance as object), photo: provenanceEntry("nanny", u.id) } }).where(eq(s.nannies.id, n.id));
    } else {
      await db.update(s.profileChangeRequests).set({ status: "superseded" }).where(and(eq(s.profileChangeRequests.nannyId, n.id), eq(s.profileChangeRequests.field, "photoKey"), eq(s.profileChangeRequests.status, "pending")));
      await db.insert(s.profileChangeRequests).values({ nannyId: n.id, field: "photoKey", oldValue: n.photoKey, newValue: key, requestedBy: u.id });
    }
    await audit(u.id, "nanny.photo_upload", "nanny", n.id);
    revalidatePath("/nanny/profile"); revalidatePath("/nanny/onboarding");
    return { ok: n.photoKey || n.status === "approved" ? "Photo sent to Omega for approval." : "Photo added." };
  });
}
export async function confirmDetailsAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    const p = { ...(n.provenance as Record<string, Record<string, unknown>>) };
    for (const k of Object.keys(p)) p[k] = { ...p[k], confirmedByNanny: true, confirmedAt: new Date().toISOString() };
    await db.update(s.nannies).set({ provenance: p }).where(eq(s.nannies.id, n.id));
    await audit(u.id, "nanny.details_confirmed", "nanny", n.id);
    revalidatePath("/nanny/onboarding");
    return { ok: "Thank you — you’ve confirmed your prepared details." };
  });
}
export async function submitProfileAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, n } = await me();
    await submitForReview(u, n);
    void deliverPending();
    revalidatePath("/nanny", "layout");
    return { ok: "Submitted. Omega will review your profile and documents and let you know." };
  });
}

export async function respondToReviewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { n } = await me();
    const r = await db.update(s.reviews).set({ nannyResponse: z.string().min(2).max(600).parse(str(fd, "response")) }).where(and(eq(s.reviews.id, str(fd, "reviewId")), eq(s.reviews.nannyId, n.id), isNull(s.reviews.nannyResponse))).returning();
    if (!r.length) throw new DomainError("Review not found or already answered.");
    return { ok: "Response saved." };
  });
}

export async function respondOfferAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser({ role: "nanny" });
    const accept = str(fd, "response") === "accept";
    await respondToOffer(u, str(fd, "bookingId"), accept, opt(fd, "note")?.slice(0, 500));
    void deliverPending();
    revalidatePath("/nanny", "layout");
    return { ok: accept ? "Thank you — Omega has been told you accept. You’ll be notified when the family confirms." : "Declined. Omega will offer the booking to someone else." };
  });
}
