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

// ---------------- Nannies & vetting ----------------
const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export async function createNannyAction(_: ActionResult, fd: FormData) {
  let id = "";
  const r = await run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const name = z.string().min(2).max(80).parse(str(fd, "displayName"));
    const email = z.string().email("Enter the nanny's email to invite them.").parse(str(fd, "email").toLowerCase());
    const [n] = await db.insert(s.nannies).values({ displayName: name, slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`, status: "invited", isDemo: env.demo }).returning();
    const token = await issueToken("invite", 24 * 7, { email, role: "nanny", subjectId: n.id, createdBy: u.id });
    await audit(u.id, "nanny.create_invite", "nanny", n.id, { email });
    id = n.id;
    return { ok: env.demo ? `/invite?token=${token}` : "Invited" };
  });
  if (id) redirect(`/manage/nannies/${id}${r?.ok?.startsWith("/invite") ? `?invite=${encodeURIComponent(r.ok)}` : ""}`);
  return r;
}
export async function updateNannyAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const id = str(fd, "nannyId");
    await db.update(s.nannies).set({
      displayName: z.string().min(2).max(80).parse(str(fd, "displayName")), headline: opt(fd, "headline"), bio: opt(fd, "bio"), yearsExperience: z.coerce.number().int().min(0).max(60).parse(str(fd, "yearsExperience")),
      services: list(fd, "services"), languages: list(fd, "languages"), ageGroups: list(fd, "ageGroups"), areas: list(fd, "areas"), skills: list(fd, "skills"), canDrive: bool(fd, "canDrive"),
      specialistExperience: opt(fd, "specialistExperience"), photoUrl: opt(fd, "photoUrl"), internalNotes: opt(fd, "internalNotes"), updatedAt: new Date(),
    }).where(eq(s.nannies.id, id));
    await audit(u.id, "nanny.update", "nanny", id);
    return done(`/manage/nannies/${id}`, "Profile saved.");
  });
}
export async function nannyStatusAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const id = str(fd, "nannyId");
    const status = z.enum(["approved", "suspended", "archived", "onboarding"]).parse(str(fd, "status"));
    if (status === "approved") {
      const checks = await db.select().from(s.verificationChecks).where(eq(s.verificationChecks.nannyId, id));
      const today = new Date().toISOString().slice(0, 10);
      const missing = (["interview", "reference", "identity", "police_clearance", "first_aid"] as const).filter((k) => !checks.some((c) => c.kind === k && c.status === "passed" && (!c.expiresOn || c.expiresOn >= today)));
      if (missing.length) throw new DomainError(`Cannot approve: ${missing.join(", ").replace(/_/g, " ")} not passed.`);
    }
    await db.update(s.nannies).set({ status, published: status === "approved" ? bool(fd, "publish") : false, updatedAt: new Date() }).where(eq(s.nannies.id, id));
    if (status === "suspended") { const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id)); if (n.userId) await db.delete(s.sessions).where(eq(s.sessions.userId, n.userId)); }
    await audit(u.id, `nanny.status_${status}`, "nanny", id, { reason: opt(fd, "reason") });
    return done(`/manage/nannies/${id}`, `Nanny ${status}.`);
  });
}
export async function recordCheckAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "vetting.manage" });
    const id = str(fd, "nannyId");
    await db.insert(s.verificationChecks).values({ nannyId: id, kind: z.enum(["interview", "reference", "identity", "police_clearance", "first_aid"]).parse(str(fd, "kind")), status: z.enum(["pending", "passed", "failed"]).parse(str(fd, "status")), notes: opt(fd, "notes"), completedOn: opt(fd, "completedOn"), expiresOn: opt(fd, "expiresOn"), recordedBy: u.id });
    await audit(u.id, "vetting.record_check", "nanny", id, { kind: str(fd, "kind"), status: str(fd, "status") });
    return done(`/manage/nannies/${id}`, "Check recorded.");
  });
}
export async function reviewDocumentAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "vetting.manage" });
    const status = z.enum(["approved", "rejected"]).parse(str(fd, "status"));
    const [d] = await db.update(s.documents).set({ status, reviewNote: opt(fd, "note"), reviewedBy: u.id, reviewedAt: new Date(), expiresOn: opt(fd, "expiresOn") ?? undefined }).where(eq(s.documents.id, str(fd, "documentId"))).returning();
    await audit(u.id, `document.${status}`, "document", d.id);
    const [n] = d.ownerNannyId ? await db.select().from(s.nannies).where(eq(s.nannies.id, d.ownerNannyId)) : [];
    if (n?.userId) await notify(n.userId, "document_reviewed", { doc: d.docType.replace("_", " "), status, note: d.reviewNote ?? "" }, `doc:${d.id}:${status}`, "/nanny/documents");
    return done(`/manage/nannies/${d.ownerNannyId}`, `Document ${status}.`);
  });
}
export async function decideChangeAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const approve = str(fd, "decision") === "approve";
    const [c] = await db.select().from(s.profileChangeRequests).where(and(eq(s.profileChangeRequests.id, str(fd, "changeId")), eq(s.profileChangeRequests.status, "pending")));
    if (!c) throw new DomainError("Change already decided.");
    const FIELDS = ["services", "ageGroups", "areas", "canDrive", "specialistExperience", "yearsExperience"];
    if (!FIELDS.includes(c.field)) throw new DomainError("Unsupported field.");
    await db.transaction(async (tx) => {
      if (approve) await tx.update(s.nannies).set({ [c.field]: c.newValue, updatedAt: new Date() }).where(eq(s.nannies.id, c.nannyId));
      await tx.update(s.profileChangeRequests).set({ status: approve ? "approved" : "rejected", decidedBy: u.id, decidedAt: new Date() }).where(eq(s.profileChangeRequests.id, c.id));
      await audit(u.id, `nanny.change_${approve ? "approved" : "rejected"}`, "nanny", c.nannyId, { field: c.field }, tx);
    });
    const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, c.nannyId));
    if (n.userId) await notify(n.userId, "profile_change_decided", { field: c.field, status: approve ? "approved" : "declined" }, `change:${c.id}`, "/nanny/profile");
    return done(`/manage/nannies/${c.nannyId}`, approve ? "Change applied." : "Change declined.");
  });
}
export async function resendNannyInviteAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ perm: "nannies.manage" });
    const email = z.string().email().parse(str(fd, "email").toLowerCase());
    const token = await issueToken("invite", 24 * 7, { email, role: "nanny", subjectId: str(fd, "nannyId"), createdBy: u.id });
    await audit(u.id, "nanny.invite", "nanny", str(fd, "nannyId"), { email });
    return { ok: env.demo ? `Demo invite link: /invite?token=${token}` : `Invitation sent to ${email}.` };
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
    const u = await assertUser({ role: "management" });
    const secret = newTotpSecret();
    await db.update(s.users).set({ mfaSecret: secret, mfaEnabled: false }).where(eq(s.users.id, u.id));
    return { ok: `Add this key to your authenticator app: ${secret} — or otpauth://totp/Omega%20Nannies:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Omega%20Nannies — then enter a code below.` };
  });
}
export async function confirmMfaAction(_: ActionResult, fd: FormData) {
  return run(async () => {
    const u = await assertUser({ role: "management" });
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    if (!row.mfaSecret || !verifyTotp(row.mfaSecret, str(fd, "code"))) throw new DomainError("Code didn't match.");
    await db.update(s.users).set({ mfaEnabled: true }).where(eq(s.users.id, u.id));
    await db.update(s.sessions).set({ mfaPassed: true }).where(eq(s.sessions.id, u.sessionId));
    await audit(u.id, "auth.mfa_enabled", "user", u.id);
    return done("/manage/admin", "Two-step verification enabled.");
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

