"use server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser } from "@/lib/auth";
import { addNote, assignNanny, createQuotation, DomainError, reschedule, runMatching, sendQuotation, transition } from "@/lib/bookings";
import { STATUSES } from "@/lib/booking-state";
import { newTotpSecret, verifyTotp } from "@/lib/crypto";
import { env } from "@/lib/env";
import { bool, list, opt, run, str } from "@/lib/forms";
import { parseMoney } from "@/lib/money";
import { deliverPending, notify } from "@/lib/notify";
import { PERMISSIONS, type Role } from "@/lib/permissions";
import { recordManualPayment, requestRefund } from "@/lib/payments/service";
import { hhmmToMinutes } from "@/lib/time";
import { issueToken } from "@/lib/tokens";
import { createNannyProfile, issueInvitation, onboardingContext, provenanceEntry, REQUIRED_DOCS, revokeInvitation, SAFEGUARDING, setContact, verifyFields } from "@/lib/onboarding";
import { importWebsiteNannies, parseCsv } from "@/lib/website-import";
import { rateLimit } from "@/lib/rate-limit";
import { storeImageUpload } from "@/lib/uploads";
import { setSetting } from "@/lib/settings";
import { resolveConflict } from "@/lib/calendar/sync";
import { adjustLedger, decideReferral } from "@/lib/growth";
import type { ActionResult } from "@/components/action-form";

const done = (path: string, ok: string): ActionResult => { revalidatePath(path); void deliverPending(); return { ok }; };
const bid = (fd: FormData) => z.string().uuid().parse(str(fd, "bookingId"));

// ---------------- Bookings ----------------
export async function runMatchingAction(_: ActionResult, fd: FormData) {
  return run(async () => { const r = await runMatching(await assertUser({ perm: "bookings.manage" }), bid(fd)); return done(`/manage/bookings/${bid(fd)}`, `${r.filter((x) => x.eligible).length} eligible of ${r.length} nannies.`); });
}
export async function assignNannyAction(_: ActionResult, fd: FormData) {
  return run(async () => { await assignNanny(await assertUser({ perm: "bookings.manage" }), bid(fd), str(fd, "nannyId"), opt(fd, "override") ?? undefined); return done(`/manage/bookings/${bid(fd)}`, "Nanny assigned."); });
}
export async function createQuoteAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    await createQuotation(u, bid(fd), { adjustmentMinor: str(fd, "adjustment") ? parseMoney(str(fd, "adjustment")) : 0, adjustmentReason: opt(fd, "adjustmentReason"), travelTrips: z.coerce.number().int().min(0).max(200).parse(str(fd, "travelTrips") || "0"), validDays: z.coerce.number().int().min(1).max(30).parse(str(fd, "validDays") || "7") });
    return done(`/manage/bookings/${bid(fd)}`, "Draft quotation created — review it, then send.");
  });
}
export async function sendQuoteAction(_: ActionResult, fd: FormData) {
  return run(async () => { await sendQuotation(await assertUser({ perm: "bookings.manage" }), str(fd, "quotationId")); return done(`/manage/bookings/${bid(fd)}`, "Quotation sent to the family."); });
}
export async function transitionAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    const to = z.enum(STATUSES).parse(str(fd, "to"));
    if (["declined", "cancelled", "disputed", "refund_pending"].includes(to) && !opt(fd, "note")) throw new DomainError("Add a note explaining this change.");
    await transition(u, bid(fd), to, opt(fd, "note") ?? undefined);
    return done(`/manage/bookings/${bid(fd)}`, "Status updated.");
  });
}
export async function rescheduleAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    await reschedule(u, bid(fd), { startDate: str(fd, "startDate"), endDate: str(fd, "endDate") || str(fd, "startDate"), dailyStartMinute: hhmmToMinutes(str(fd, "startTime")), dailyEndMinute: hhmmToMinutes(str(fd, "endTime")), reason: str(fd, "reason") });
    return done(`/manage/bookings/${bid(fd)}`, "Rescheduled.");
  });
}
export async function noteAction(_: ActionResult, fd: FormData) {
  return run(async () => { await addNote(await assertUser({ perm: "bookings.manage" }), bid(fd), z.string().min(1).max(2000).parse(str(fd, "note")), !bool(fd, "shared")); return done(`/manage/bookings/${bid(fd)}`, "Note added."); });
}
export async function responsibilitiesAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    await db.update(s.bookings).set({ responsibilities: opt(fd, "responsibilities")?.slice(0, 2000) ?? null }).where(eq(s.bookings.id, bid(fd)));
    await audit(u.id, "booking.responsibilities", "booking", bid(fd));
    return done(`/manage/bookings/${bid(fd)}`, "Saved.");
  });
}
export async function recordPaymentAction(_: ActionResult, fd: FormData) {
  return run(async () => { const r = await recordManualPayment(await assertUser({ perm: "payments.manage" }), str(fd, "invoiceId"), str(fd, "reference")); return done(`/manage/bookings/${bid(fd)}`, `EFT recorded (${r.replace("_", " ")}).`); });
}
export async function refundAction(_: ActionResult, fd: FormData) {
  return run(async () => { await requestRefund(await assertUser({ perm: "payments.manage" }), str(fd, "paymentId"), parseMoney(str(fd, "amount")), z.string().min(3).parse(str(fd, "reason"))); return done(`/manage/bookings/${bid(fd)}`, "Refund recorded as pending. Process it with the provider, then mark complete."); });
}
export async function completeRefundAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "payments.manage" });
    const [r] = await db.update(s.refunds).set({ status: "completed", completedAt: new Date() }).where(and(eq(s.refunds.id, str(fd, "refundId")), eq(s.refunds.status, "pending"))).returning();
    if (!r) throw new DomainError("Refund not pending.");
    await audit(u.id, "refund.complete", "refund", r.id);
    return done(`/manage/bookings/${bid(fd)}`, "Refund marked complete.");
  });
}
export async function meetingAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    const id = opt(fd, "meetingId");
    if (id) {
      const status = z.enum(["scheduled", "held", "no_show", "cancelled"]).parse(str(fd, "status"));
      await db.update(s.meetings).set({ status, updatedAt: new Date() }).where(eq(s.meetings.id, id));
      return done(`/manage/bookings/${bid(fd)}`, "Meeting updated.");
    }
    const startsAt = new Date(`${str(fd, "date")}T${str(fd, "time")}:00+02:00`);
    if (Number.isNaN(startsAt.getTime()) || startsAt < new Date()) throw new DomainError("Choose a future date and time.");
    const joinUrl = opt(fd, "joinUrl");
    if (joinUrl && !/^https:\/\/[^\s]+$/.test(joinUrl)) throw new DomainError("Meeting links must start with https://");
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bid(fd)));
    const [m] = await db.insert(s.meetings).values({ bookingId: b.id, startsAt, provider: z.enum(["zoom", "google_meet", "teams", "whatsapp", "in_person", "other"]).parse(str(fd, "provider")), joinUrl, status: "scheduled", createdBy: u.id }).returning();
    if (b.status === "matching") await transition(u, b.id, "introduction", "Introduction scheduled");
    const who = [...(b.familyId ? (await db.select().from(s.familyMembers).where(eq(s.familyMembers.familyId, b.familyId))).map((x) => x.userId) : [])];
    if (b.nannyId) { const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, b.nannyId)); if (n?.userId) who.push(n.userId); }
    for (const w of who) await notify(w, "meeting_scheduled", { ref: b.reference, when: startsAt.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }), link: joinUrl ?? "" }, `meeting:${m.id}`, undefined);
    return done(`/manage/bookings/${b.id}`, "Introduction scheduled and participants notified.");
  });
}
/** Turns a website enquiry into a family record and invites the enquirer to the portal. */
export async function convertEnquiryAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "families.manage" });
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bid(fd)));
    if (!b || b.familyId || !b.enquiryEmail) throw new DomainError("This booking is already linked to a family.");
    const [f] = await db.insert(s.families).values({ displayName: `${b.enquiryName} household`, billingName: b.enquiryName, billingEmail: b.enquiryEmail, isDemo: b.isDemo }).returning();
    await db.update(s.bookings).set({ familyId: f.id }).where(eq(s.bookings.id, b.id));
    const token = await issueToken("invite", 24 * 7, { email: b.enquiryEmail, role: "family", subjectId: f.id, createdBy: u.id });
    await audit(u.id, "enquiry.convert", "booking", b.id, { familyId: f.id });
    revalidatePath(`/manage/bookings/${b.id}`);
    return { ok: env.demo ? `Family created. Demo invite link: /invite?token=${token}` : `Family created and invitation emailed to ${b.enquiryEmail}.` };
  });
}

// ---------------- Nannies, onboarding & vetting ----------------
const nannyPath = (id: string) => `/manage/nannies/${id}`;
const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export async function createNannyAction(_: ActionResult, fd: FormData) {
  let id = "";
  const r = await run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    id = (await createNannyProfile(u, { displayName: str(fd, "displayName"), contactEmail: opt(fd, "email"), contactPhone: opt(fd, "phone"), headline: opt(fd, "headline") })).id;
    return { ok: "Created" };
  });
  if (id) redirect(nannyPath(id));
  return r;
}
const EDITABLE = ["displayName", "headline", "bio", "yearsExperience", "services", "languages", "ageGroups", "areas", "skills", "canDrive", "specialistExperience"] as const;
export async function updateNannyAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const id = str(fd, "nannyId");
    const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id));
    if (!n) throw new DomainError("Nanny not found.");
    const next: Record<string, unknown> = {
      displayName: z.string().trim().min(2).max(80).parse(str(fd, "displayName")), headline: opt(fd, "headline")?.slice(0, 140) ?? null, bio: opt(fd, "bio")?.slice(0, 3000) ?? null,
      yearsExperience: z.coerce.number().int().min(0).max(60).parse(str(fd, "yearsExperience")), services: list(fd, "services"), languages: list(fd, "languages"),
      ageGroups: list(fd, "ageGroups"), areas: list(fd, "areas"), skills: list(fd, "skills"), canDrive: bool(fd, "canDrive"), specialistExperience: opt(fd, "specialistExperience")?.slice(0, 1000) ?? null,
    };
    const prov = { ...(n.provenance as Record<string, unknown>) };
    for (const k of EDITABLE) if (JSON.stringify(next[k]) !== JSON.stringify((n as Record<string, unknown>)[k])) prov[k] = provenanceEntry("admin", u.id);
    await db.update(s.nannies).set({ ...next, provenance: prov, internalNotes: opt(fd, "internalNotes"), updatedAt: new Date() }).where(eq(s.nannies.id, id));
    await audit(u.id, "nanny.update", "nanny", id);
    return done(nannyPath(id), "Profile saved.");
  });
}
export async function contactAction(_: ActionResult, fd: FormData) {
  return run(async () => { const u = await assertUser({ perm: "nannies.manage" }); await setContact(u, str(fd, "nannyId"), opt(fd, "email"), opt(fd, "phone")); return done(nannyPath(str(fd, "nannyId")), "Contact details saved."); });
}
export async function inviteNannyAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const { link, delivery } = await issueInvitation(u, str(fd, "nannyId"));
    revalidatePath(nannyPath(str(fd, "nannyId")));
    if (delivery === "failed") return { error: "The invitation was created but the email could not be sent. Check email settings, then resend." };
    return { ok: delivery === "captured" ? `Invitation created. Email delivery is not configured (demo), so share this one-time link securely: ${link}` : "Invitation emailed. It expires in 7 days." };
  });
}
export async function bulkInviteAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const ids = list(fd, "ids").slice(0, 50);
    if (!ids.length) throw new DomainError("Select at least one nanny.");
    const results = { sent: 0, skipped: [] as string[] };
    for (const id of ids) {
      try { await issueInvitation(u, id); results.sent++; } catch (e) { results.skipped.push((e as Error).message); }
    }
    revalidatePath("/manage/nannies");
    return { ok: `${results.sent} invitation(s) created.${results.skipped.length ? ` ${results.skipped.length} skipped (no email, already claimed, or limited).` : ""}` };
  });
}
export async function revokeInviteAction(_: ActionResult, fd: FormData) {
  return run(async () => { const u = await assertUser({ perm: "nannies.manage" }); const inv = await revokeInvitation(u, str(fd, "invitationId")); return done(nannyPath(inv.nannyId), "Invitation revoked — the link no longer works."); });
}
export async function importWebsiteAction(_: ActionResult, _fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    if (!(await rateLimit("import:website", 6, 3600))) throw new DomainError("The website import has run several times recently. Try again later.");
    const r = await importWebsiteNannies(u.id, { isDemo: env.demo });
    revalidatePath("/manage/nannies");
    return { ok: `Website import: ${r.found} found · ${r.created} new drafts · ${r.updated} updated · ${r.unchanged} unchanged · ${r.photos} photos · ${r.skippedFields} fields kept (edited or verified).${r.errors.length ? ` ${r.errors.length} errors.` : ""}` };
  });
}
export async function csvImportAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new DomainError("Choose a CSV file.");
    if (file.size > 512 * 1024) throw new DomainError("CSV files must be 512 KB or smaller.");
    const rows = parseCsv(await file.text()).slice(0, 500);
    if (!rows.length || !("name" in rows[0])) throw new DomainError("The CSV needs a header row with at least a “name” column.");
    let created = 0; const errors: string[] = [];
    const split = (x?: string) => (x ?? "").split(/[;|]/).map((v) => v.trim()).filter(Boolean);
    for (const [i, row] of rows.entries()) {
      try {
        const n = await createNannyProfile(u, { displayName: row.name, contactEmail: row.email || null, contactPhone: row.phone || null, headline: row.headline || null });
        const extra = { bio: row.bio || null, yearsExperience: Math.min(60, Number(row.years) || 0), languages: split(row.languages), areas: split(row.areas), services: split(row.services) };
        const prov = { ...(n.provenance as Record<string, unknown>) };
        for (const [k, v] of Object.entries(extra)) if (v && (!Array.isArray(v) || v.length)) prov[k] = provenanceEntry("csv", u.id);
        await db.update(s.nannies).set({ ...extra, importSource: "csv", sourceRef: `csv:${n.id}`, importedAt: new Date(), provenance: prov }).where(eq(s.nannies.id, n.id));
        created++;
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    }
    await audit(u.id, "import.csv", "nanny", null, { created, errors: errors.length });
    revalidatePath("/manage/nannies");
    return errors.length ? { error: `${created} created. ${errors.slice(0, 5).join(" ")}` } : { ok: `${created} draft profiles created.` };
  });
}
export async function verifyFieldsAction(_: ActionResult, fd: FormData) {
  return run(async () => { const u = await assertUser({ perm: "vetting.manage" }); await verifyFields(u, str(fd, "nannyId"), list(fd, "fields").filter((f) => (EDITABLE as readonly string[]).includes(f) || f === "photo")); return done(nannyPath(str(fd, "nannyId")), "Fields marked as verified by Omega."); });
}
export async function adminPhotoAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const id = str(fd, "nannyId");
    const { key } = await storeImageUpload(fd.get("file"));
    const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id));
    if (!n) throw new DomainError("Nanny not found.");
    await db.update(s.nannies).set({ photoKey: key, photoUrl: `/api/photos/${id}`, provenance: { ...(n.provenance as object), photo: provenanceEntry("admin", u.id) }, updatedAt: new Date() }).where(eq(s.nannies.id, id));
    await audit(u.id, "nanny.photo_update", "nanny", id);
    return done(nannyPath(id), "Photo updated.");
  });
}
export async function nannyStatusAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const id = str(fd, "nannyId");
    const action = z.enum(["approve", "publish", "unpublish", "suspend", "archive", "reopen"]).parse(str(fd, "status"));
    const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id));
    if (!n) throw new DomainError("Nanny not found.");
    if (action === "approve") {
      if (!n.userId) throw new DomainError("The nanny must claim their account before approval.");
      const ctx = await onboardingContext([id]);
      const today = new Date().toISOString().slice(0, 10);
      const missing = SAFEGUARDING.filter((k) => !ctx.checks.some((c) => c.kind === k && c.status === "passed" && (!c.expiresOn || c.expiresOn >= today)));
      if (missing.length) throw new DomainError(`Cannot approve: ${missing.join(", ").replace(/_/g, " ")} not passed.`);
      const approvedDocs = new Set(ctx.docs.filter((d) => d.status === "approved").map((d) => d.docType));
      const missingDocs = REQUIRED_DOCS.filter((d) => !approvedDocs.has(d));
      if (missingDocs.length) throw new DomainError(`Cannot approve: approve these documents first — ${missingDocs.join(", ").replace(/_/g, " ")}.`);
    }
    if (action === "publish" && n.status !== "approved") throw new DomainError("Only approved nannies can be published.");
    const patch = { approve: { status: "approved" as const }, publish: { published: true }, unpublish: { published: false }, suspend: { status: "suspended" as const, published: false }, archive: { status: "archived" as const, published: false }, reopen: { status: "onboarding" as const, published: false } }[action];
    await db.update(s.nannies).set({ ...patch, updatedAt: new Date() }).where(eq(s.nannies.id, id));
    if (action === "suspend" && n.userId) await db.delete(s.sessions).where(eq(s.sessions.userId, n.userId));
    await audit(u.id, `nanny.${action}`, "nanny", id, { reason: opt(fd, "reason") });
    return done(nannyPath(id), { approve: "Approved.", publish: "Published to families.", unpublish: "Hidden from families.", suspend: "Suspended and signed out.", archive: "Archived.", reopen: "Returned to onboarding." }[action]);
  });
}
export async function recordCheckAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "vetting.manage" });
    const id = z.string().uuid().parse(str(fd, "nannyId"));
    const [n] = await db.select({ id: s.nannies.id }).from(s.nannies).where(eq(s.nannies.id, id));
    if (!n) throw new DomainError("Nanny not found.");
    const status = z.enum(["pending", "passed", "failed"]).parse(str(fd, "status"));
    if (status === "passed" && !opt(fd, "completedOn")) throw new DomainError("Enter the date the check was completed.");
    await db.insert(s.verificationChecks).values({ nannyId: id, kind: z.enum(SAFEGUARDING).parse(str(fd, "kind")), status, notes: opt(fd, "notes"), completedOn: opt(fd, "completedOn"), expiresOn: opt(fd, "expiresOn"), recordedBy: u.id });
    await audit(u.id, "vetting.record_check", "nanny", id, { kind: str(fd, "kind"), status });
    return done(nannyPath(id), "Check recorded.");
  });
}
export async function reviewDocumentAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "vetting.manage" });
    const status = z.enum(["approved", "rejected"]).parse(str(fd, "status"));
    const [cur] = await db.select().from(s.documents).where(eq(s.documents.id, str(fd, "documentId")));
    if (!cur) throw new DomainError("Document not found.");
    if (cur.scanStatus === "infected") throw new DomainError("This file failed the malware scan and cannot be approved.");
    const [d] = await db.update(s.documents).set({ status, reviewNote: opt(fd, "note"), reviewedBy: u.id, reviewedAt: new Date(), expiresOn: opt(fd, "expiresOn") ?? cur.expiresOn }).where(eq(s.documents.id, cur.id)).returning();
    await audit(u.id, `document.${status}`, "document", d.id);
    const [n] = d.ownerNannyId ? await db.select().from(s.nannies).where(eq(s.nannies.id, d.ownerNannyId)) : [];
    if (n?.userId) await notify(n.userId, "document_reviewed", { doc: d.docType.replace(/_/g, " "), status, note: d.reviewNote ?? "" }, `doc:${d.id}:${status}`, "/nanny/documents");
    return done(d.ownerNannyId ? nannyPath(d.ownerNannyId) : "/manage/families", `Document ${status}.`);
  });
}
const CHANGE_FIELDS = ["services", "ageGroups", "areas", "canDrive", "specialistExperience", "yearsExperience", "photoKey"];
export async function decideChangeAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const approve = str(fd, "decision") === "approve";
    const [c] = await db.select().from(s.profileChangeRequests).where(and(eq(s.profileChangeRequests.id, str(fd, "changeId")), eq(s.profileChangeRequests.status, "pending")));
    if (!c) throw new DomainError("Change already decided.");
    if (!CHANGE_FIELDS.includes(c.field)) throw new DomainError("Unsupported field.");
    await db.transaction(async (tx) => {
      if (approve) {
        const [n] = await tx.select().from(s.nannies).where(eq(s.nannies.id, c.nannyId));
        const provKey = c.field === "photoKey" ? "photo" : c.field;
        const extra = c.field === "photoKey" ? { photoUrl: `/api/photos/${c.nannyId}` } : {};
        await tx.update(s.nannies).set({ [c.field]: c.newValue, ...extra, provenance: { ...(n.provenance as object), [provKey]: provenanceEntry("nanny", n.userId) }, updatedAt: new Date() }).where(eq(s.nannies.id, c.nannyId));
      }
      await tx.update(s.profileChangeRequests).set({ status: approve ? "approved" : "rejected", decidedBy: u.id, decidedAt: new Date() }).where(eq(s.profileChangeRequests.id, c.id));
      await audit(u.id, `nanny.change_${approve ? "approved" : "rejected"}`, "nanny", c.nannyId, { field: c.field }, tx);
    });
    const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, c.nannyId));
    if (n.userId) await notify(n.userId, "profile_change_decided", { field: c.field === "photoKey" ? "profile photo" : c.field, status: approve ? "approved" : "declined" }, `change:${c.id}`, "/nanny/profile");
    return done(nannyPath(c.nannyId), approve ? "Change applied." : "Change declined.");
  });
}

// ---------------- Families ----------------
export async function familyAdminAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "families.manage" });
    const id = str(fd, "familyId");
    await db.update(s.families).set({ restricted: bool(fd, "restricted"), internalNotes: opt(fd, "internalNotes"), audience: z.enum(["visiting", "resident"]).parse(str(fd, "audience")) }).where(eq(s.families.id, id));
    await audit(u.id, "family.admin_update", "family", id, { restricted: bool(fd, "restricted") });
    return done(`/manage/families/${id}`, "Saved.");
  });
}

// ---------------- Pricing ----------------
export async function newPriceDraftAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "pricing.manage" });
    const [latest] = await db.select().from(s.priceBooks).orderBy(desc(s.priceBooks.version)).limit(1);
    const items = latest ? await db.select().from(s.priceItems).where(eq(s.priceItems.priceBookId, latest.id)) : [];
    const [pb] = await db.insert(s.priceBooks).values({ version: (latest?.version ?? 0) + 1, label: z.string().min(2).max(80).parse(str(fd, "label")), status: "draft", currency: "ZAR", createdBy: u.id }).returning();
    if (items.length) await db.insert(s.priceItems).values(items.map(({ id: _i, priceBookId: _p, ...rest }) => ({ ...rest, priceBookId: pb.id })));
    await audit(u.id, "pricing.draft_create", "price_book", pb.id, { from: latest?.version });
    return done("/manage/pricing", `Draft v${pb.version} created.`);
  });
}
export async function savePriceItemAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "pricing.manage" });
    const [item] = await db.select({ i: s.priceItems, status: s.priceBooks.status }).from(s.priceItems).innerJoin(s.priceBooks, eq(s.priceBooks.id, s.priceItems.priceBookId)).where(eq(s.priceItems.id, str(fd, "itemId")));
    if (!item || item.status !== "draft") throw new DomainError("Only draft price books can be edited. Create a new draft.");
    const raw = str(fd, "amount");
    const amount = item.i.unit === "bps" ? Math.round(Number(raw) * 100) : item.i.unit === "hours" ? z.coerce.number().int().min(0).max(24).parse(raw) : parseMoney(raw);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new DomainError("Enter a valid amount.");
    await db.update(s.priceItems).set({ amount, label: str(fd, "label") || item.i.label }).where(eq(s.priceItems.id, item.i.id));
    await audit(u.id, "pricing.item_update", "price_item", item.i.id, { amount });
    return done("/manage/pricing", "Saved.");
  });
}
export async function publishPriceBookAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "pricing.manage" });
    const id = str(fd, "priceBookId");
    const eff = opt(fd, "effectiveFrom") ? new Date(`${str(fd, "effectiveFrom")}T00:00:00+02:00`) : new Date();
    await db.transaction(async (tx) => {
      const [pb] = await tx.update(s.priceBooks).set({ status: "published", effectiveFrom: eff, publishedBy: u.id }).where(and(eq(s.priceBooks.id, id), eq(s.priceBooks.status, "draft"))).returning();
      if (!pb) throw new DomainError("Only drafts can be published.");
      if (eff <= new Date()) await tx.update(s.priceBooks).set({ status: "retired" }).where(and(eq(s.priceBooks.status, "published"), ne(s.priceBooks.id, id), sql`${s.priceBooks.version} < ${pb.version}`));
      await audit(u.id, "pricing.publish", "price_book", id, { effectiveFrom: eff.toISOString() }, tx);
    });
    return done("/manage/pricing", "Published. Existing quotations and confirmed bookings keep their agreed prices.");
  });
}

// ---------------- Content ----------------
export async function saveArticleAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "content.manage" });
    const v = { title: z.string().min(3).max(200).parse(str(fd, "title")), body: z.string().min(10).max(10000).parse(str(fd, "body")), category: str(fd, "category") || "General", audience: z.enum(["public", "family", "nanny", "internal"]).parse(str(fd, "audience")), published: bool(fd, "published"), aiApproved: bool(fd, "aiApproved"), updatedBy: u.id, updatedAt: new Date() };
    const id = opt(fd, "id");
    if (id) await db.update(s.faqArticles).set(v).where(eq(s.faqArticles.id, id));
    else await db.insert(s.faqArticles).values({ ...v, slug: `${slugify(v.title).slice(0, 70)}-${Date.now().toString(36)}` });
    await audit(u.id, id ? "content.update" : "content.create", "faq_article", id);
    return done("/manage/content", "Article saved.");
  });
}

// ---------------- Support & reviews ----------------
export async function supportStatusAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management" });
    const [r] = await db.update(s.supportRequests).set({ status: z.enum(["open", "in_progress", "resolved"]).parse(str(fd, "status")), assignedTo: u.id, updatedAt: new Date() }).where(eq(s.supportRequests.id, str(fd, "id"))).returning();
    if (r.userId) await notify(r.userId, "support_update", { subject: r.subject, status: r.status.replace("_", " ") }, `support:${r.id}:${r.status}`);
    return done("/manage/support", "Updated.");
  });
}
export async function moderateReviewAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "reviews.moderate" });
    const status = z.enum(["published", "rejected", "removed"]).parse(str(fd, "status"));
    await db.update(s.reviews).set({ status, moderationNote: opt(fd, "note") }).where(eq(s.reviews.id, str(fd, "id")));
    await audit(u.id, `review.${status}`, "review", str(fd, "id"), { note: opt(fd, "note") });
    return done("/manage/support", `Review ${status}.`);
  });
}

// ---------------- Administration ----------------
export async function inviteStaffAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "users.manage" });
    const email = z.string().email().parse(str(fd, "email").toLowerCase());
    const role = z.enum(["ops", "manager", "admin"]).parse(str(fd, "role")) as Role;
    const token = await issueToken("invite", 72, { email, role, createdBy: u.id });
    await audit(u.id, "staff.invite", "user", null, { email, role });
    return { ok: env.demo ? `Demo invite link: /invite?token=${token}` : `Invitation sent to ${email}.` };
  });
}
export async function staffAccessAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "users.manage" });
    const id = str(fd, "userId");
    if (id === u.id && str(fd, "status") !== "active") throw new DomainError("You can't suspend your own account.");
    const perms = list(fd, "permissions").filter((p) => p in PERMISSIONS);
    const status = z.enum(["active", "suspended"]).parse(str(fd, "status"));
    await db.update(s.users).set({ permissions: perms, status, updatedAt: new Date() }).where(eq(s.users.id, id));
    if (status === "suspended") await db.delete(s.sessions).where(eq(s.sessions.userId, id));
    await audit(u.id, "staff.access_update", "user", id, { permissions: perms, status });
    return done("/manage/admin", "Access updated.");
  });
}
export async function userStatusAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "users.manage" });
    const id = str(fd, "userId");
    if (id === u.id) throw new DomainError("You can't change your own status.");
    const status = z.enum(["active", "suspended"]).parse(str(fd, "status"));
    await db.update(s.users).set({ status }).where(eq(s.users.id, id));
    if (status === "suspended") await db.delete(s.sessions).where(eq(s.sessions.userId, id));
    await audit(u.id, `user.${status}`, "user", id, { reason: opt(fd, "reason") });
    revalidatePath("/manage", "layout");
    return { ok: `Account ${status}.` };
  });
}
export async function startMfaAction(_: ActionResult, _fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management", allowWithoutMfa: true });
    const secret = newTotpSecret();
    await db.update(s.users).set({ mfaSecret: secret, mfaEnabled: false }).where(eq(s.users.id, u.id));
    return { ok: `Add this key to your authenticator app: ${secret} — or use otpauth://totp/Omega%20Nannies:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Omega%20Nannies — then enter a code below.` };
  });
}
export async function confirmMfaAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management", allowWithoutMfa: true });
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    if (!row.mfaSecret || !verifyTotp(row.mfaSecret, str(fd, "code"))) throw new DomainError("Code didn't match.");
    await db.update(s.users).set({ mfaEnabled: true }).where(eq(s.users.id, u.id));
    await db.update(s.sessions).set({ mfaPassed: true }).where(eq(s.sessions.id, u.sessionId));
    await audit(u.id, "auth.mfa_enabled", "user", u.id);
    revalidatePath("/", "layout");
    return { ok: "Two-step verification enabled." };
  });
}
export async function retentionAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "settings.manage" });
    const value = { messagesMonths: z.coerce.number().int().min(6).max(120).parse(str(fd, "messagesMonths")), closedAccountMonths: z.coerce.number().int().min(1).max(120).parse(str(fd, "closedAccountMonths")), financialYears: z.coerce.number().int().min(5).max(10).parse(str(fd, "financialYears")) };
    await db.insert(s.settings).values({ key: "retention", value, updatedBy: u.id }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedBy: u.id, updatedAt: new Date() } });
    await audit(u.id, "settings.retention", "settings", "retention", value);
    return done("/manage/admin", "Retention settings saved.");
  });
}


// ---------------- Internal tasks ----------------
export async function saveTaskAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management" });
    const v = z.object({ title: z.string().trim().min(2, "Give the task a title.").max(200), notes: z.string().max(2000).nullable(), priority: z.enum(["low", "normal", "high"]), dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), assigneeId: z.string().uuid().nullable() })
      .parse({ title: str(fd, "title"), notes: opt(fd, "notes"), priority: str(fd, "priority") || "normal", dueOn: opt(fd, "dueOn"), assigneeId: opt(fd, "assigneeId") });
    const link = { bookingId: opt(fd, "bookingId"), nannyId: opt(fd, "nannyId"), familyId: opt(fd, "familyId") };
    const [t] = await db.insert(s.tasks).values({ ...v, ...link, createdBy: u.id }).returning();
    if (v.assigneeId && v.assigneeId !== u.id) await notify(v.assigneeId, "support_update", { subject: `Task: ${v.title}`, status: "assigned to you" }, `task:${t.id}`, "/manage/tasks");
    await audit(u.id, "task.create", "task", t.id);
    revalidatePath("/manage/tasks");
    return { ok: "Task added." };
  });
}
export async function taskStatusAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management" });
    const status = z.enum(["open", "done"]).parse(str(fd, "status"));
    await db.update(s.tasks).set({ status, completedAt: status === "done" ? new Date() : null }).where(eq(s.tasks.id, str(fd, "taskId")));
    await audit(u.id, `task.${status}`, "task", str(fd, "taskId"));
    revalidatePath("/manage/tasks");
    return { ok: status === "done" ? "Completed." : "Reopened." };
  });
}

// ---------------- Platform settings ----------------
export async function platformSettingsAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "settings.manage" });
    await setSetting("addressReveal", str(fd, "addressReveal"), u.id);
    await setSetting("requireNannyAcceptance", bool(fd, "requireNannyAcceptance"), u.id);
    await audit(u.id, "settings.platform", "settings", "platform", { addressReveal: str(fd, "addressReveal"), requireNannyAcceptance: bool(fd, "requireNannyAcceptance") });
    return done("/manage/admin", "Settings saved.");
  });
}

export async function resolveCalendarConflictAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "bookings.manage" });
    const action = str(fd, "action") === "restore" ? "restore" : "dismiss";
    if (!(await resolveConflict(u.id, str(fd, "id"), action))) throw new DomainError("This conflict is already resolved.");
    return done("/manage/admin", action === "restore" ? "Omega's booking event restored in the connected calendar." : "Conflict closed.");
  });
}

export async function referralSettingsAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "settings.manage" });
    const rewardValue = str(fd, "rewardType") === "points" ? Number.parseInt(str(fd, "rewardValue") || "0", 10) : parseMoney(str(fd, "rewardValue") || "0");
    const v = { enabled: bool(fd, "enabled"), rewardType: str(fd, "rewardType"), rewardValue, qualification: str(fd, "qualification"), expiryDays: Number.parseInt(str(fd, "expiryDays") || "365", 10), maxRewardsPerReferrer: Number.parseInt(str(fd, "maxRewardsPerReferrer") || "10", 10), services: list(fd, "services"), requireApproval: bool(fd, "requireApproval") };
    if (v.enabled && !v.rewardValue) throw new DomainError("Set a reward value before switching the programme on.");
    await setSetting("referral", v, u.id);
    await audit(u.id, "settings.referral", "settings", "referral", v);
    return done("/manage/growth", v.enabled ? "Referral programme saved and active." : "Referral programme saved (inactive).");
  });
}
export async function loyaltySettingsAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "settings.manage" });
    const n = (k: string) => Number.parseInt(str(fd, k) || "0", 10);
    const v = { enabled: bool(fd, "enabled"), pointsPerCompletedBooking: n("pointsPerCompletedBooking"), milestoneEvery: n("milestoneEvery"), milestonePoints: n("milestonePoints") };
    await setSetting("loyalty", v, u.id);
    await audit(u.id, "settings.loyalty", "settings", "loyalty", v);
    return done("/manage/growth", v.enabled ? "Loyalty programme saved and active." : "Loyalty programme saved (inactive).");
  });
}
export async function decideReferralAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "payments.manage" });
    await decideReferral(u, str(fd, "id"), str(fd, "decision") === "approve");
    return done("/manage/growth", str(fd, "decision") === "approve" ? "Reward approved and added to the ledger." : "Referral marked not eligible.");
  });
}
export async function adjustLedgerAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "payments.manage" });
    const kind = str(fd, "kind") === "points" ? "points" : "credit_minor";
    const raw = str(fd, "amount");
    const delta = kind === "points" ? Number.parseInt(raw, 10) : (raw.trim().startsWith("-") ? -1 : 1) * parseMoney(raw.replace("-", ""));
    await adjustLedger(u, str(fd, "familyId"), kind, delta, str(fd, "reason") === "redemption" ? "redemption" : "adjustment", str(fd, "note"));
    return done("/manage/growth", "Ledger updated.");
  });
}
