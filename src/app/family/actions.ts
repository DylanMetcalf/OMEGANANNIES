"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser } from "@/lib/auth";
import { acceptQuotation, bookingAccess, DomainError, familyIdsOf, transition } from "@/lib/bookings";
import { bool, opt, run, str } from "@/lib/forms";
import { deliverPending } from "@/lib/notify";
import { startPayment } from "@/lib/payments/service";
import { issueToken } from "@/lib/tokens";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { storeDocumentUpload } from "@/lib/uploads";
import type { ActionResult } from "@/components/action-form";

async function familyUser() {
  const u = await assertUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  if (!familyId) throw new DomainError("No household is linked to your account.");
  return { u, familyId };
}

export async function cancelBookingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser({ role: "family" });
    await transition(u, str(fd, "bookingId"), "cancelled", opt(fd, "reason") ?? "Cancelled by family");
    void deliverPending();
    revalidatePath(`/family/bookings/${str(fd, "bookingId")}`);
    return { ok: "Booking cancelled. Our team will be in touch about any fees or refunds under your quotation terms." };
  });
}

export async function acceptQuoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser({ role: "family" });
    await acceptQuotation(u, str(fd, "quotationId"), bool(fd, "terms"));
    revalidatePath("/family", "layout");
    return { ok: "Quotation accepted — your nanny's dates are held while you pay the deposit." };
  });
}

export async function payInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let url = "";
  const r = await run(async () => {
    const u = await assertUser({ role: "family" });
    url = `/pay/${(await startPayment(u, str(fd, "invoiceId"))).paymentId}`;
    return { ok: "Redirecting to payment" };
  });
  if (url) redirect(url);
  return r;
}

const childSchema = z.object({
  preferredName: z.string().min(1, "Enter a name.").max(60), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  careRequirements: z.string().max(1000).nullable(), allergies: z.string().max(500).nullable(), dietaryNeeds: z.string().max(500).nullable(), routines: z.string().max(1000).nullable(),
  interests: z.string().max(500).nullable(), additionalNeeds: z.string().max(1000).nullable(), emergencyInstructions: z.string().max(1000).nullable(),
});
export async function saveChildAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const v = childSchema.parse(Object.fromEntries(Object.keys(childSchema.shape).map((k) => [k, opt(fd, k)])));
    if (v.dateOfBirth && v.dateOfBirth > new Date().toISOString().slice(0, 10)) throw new DomainError("Date of birth can't be in the future.");
    if (!bool(fd, "consent")) throw new DomainError("Please confirm you have authority to share this child's information.");
    const id = opt(fd, "id");
    if (id) {
      const r = await db.update(s.children).set({ ...v, updatedAt: new Date() }).where(and(eq(s.children.id, id), eq(s.children.familyId, familyId))).returning();
      if (!r.length) throw new DomainError("Child not found.");
    } else await db.insert(s.children).values({ ...v, familyId, consentRecordedAt: new Date() });
    await db.insert(s.consents).values({ userId: u.id, policy: "child_data", version: "2026-10", granted: true });
    await audit(u.id, id ? "child.update" : "child.create", "child", id, undefined);
    revalidatePath("/family/my-family");
    return { ok: "Saved." };
  });
}
export async function deleteChildAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const id = str(fd, "id");
    const used = await db.select().from(s.bookingChildren).where(eq(s.bookingChildren.childId, id)).limit(1);
    if (used.length) throw new DomainError("This child is linked to bookings. Message our team to have their record removed under our retention policy.");
    await db.delete(s.children).where(and(eq(s.children.id, id), eq(s.children.familyId, familyId)));
    await audit(u.id, "child.delete", "child", id);
    revalidatePath("/family/my-family");
    return { ok: "Removed." };
  });
}

export async function saveHouseholdAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const f = (k: string, max = 300) => opt(fd, k)?.slice(0, max) ?? null;
    await db.update(s.families).set({
      displayName: str(fd, "displayName").slice(0, 120) || "My household", countryOfResidence: f("countryOfResidence", 80), preferredLanguage: f("preferredLanguage", 40),
      preferredChannel: z.enum(["email", "whatsapp", "phone"]).parse(str(fd, "preferredChannel")), billingName: f("billingName"), billingEmail: f("billingEmail"), billingAddress: f("billingAddress", 500),
      bookingPreferences: f("bookingPreferences", 1000), emergencyContactName: f("emergencyContactName"), emergencyContactPhone: f("emergencyContactPhone", 40), updatedAt: new Date(),
    }).where(eq(s.families.id, familyId));
    await audit(u.id, "family.update", "family", familyId);
    revalidatePath("/family/my-family");
    return { ok: "Household details saved." };
  });
}
export async function addLocationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { familyId } = await familyUser();
    const v = z.object({ label: z.string().min(1, "Add a label.").max(60), area: z.string().min(1, "Choose an area."), addressLine: z.string().max(300).nullable(), accessNotes: z.string().max(500).nullable() })
      .parse({ label: str(fd, "label"), area: str(fd, "area"), addressLine: opt(fd, "addressLine"), accessNotes: opt(fd, "accessNotes") });
    await db.insert(s.serviceLocations).values({ ...v, familyId });
    revalidatePath("/family/my-family");
    return { ok: "Location added." };
  });
}
export async function inviteHouseholdMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const email = z.string().email("Enter a valid email.").parse(str(fd, "email").toLowerCase());
    const token = await issueToken("invite", 24 * 7, { email, role: "family", subjectId: familyId, createdBy: u.id });
    await audit(u.id, "family.invite_member", "family", familyId, { email });
    return { ok: env.demo ? `Invitation created. Demo link: /invite?token=${token}` : `Invitation sent to ${email}.` };
  });
}

export async function submitReviewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser({ role: "family" });
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, str(fd, "bookingId")));
    if (!b || (await bookingAccess(u, b)).level !== "family") throw new DomainError("Booking not found.");
    if (b.status !== "completed" || !b.nannyId) throw new DomainError("Reviews open once a booking is completed.");
    const v = z.object({ rating: z.coerce.number().int().min(1).max(5), body: z.string().min(10, "Tell us a little more (at least 10 characters).").max(2000) }).parse({ rating: str(fd, "rating"), body: str(fd, "body") });
    const r = await db.insert(s.reviews).values({ bookingId: b.id, familyId: b.familyId!, nannyId: b.nannyId, ...v }).onConflictDoNothing().returning();
    if (!r.length) throw new DomainError("You've already reviewed this booking.");
    revalidatePath(`/family/bookings/${b.id}`);
    return { ok: "Thank you! Your review will appear once our team has checked it." };
  });
}

export async function markNotificationsReadAction() {
  const u = await assertUser();
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app")));
  revalidatePath("/", "layout");
}

export async function uploadFamilyDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    if (!(await rateLimit(`upload:${u.id}`, 10, 3600))) throw new DomainError("Upload limit reached. Try again later.");
    const docType = z.enum(["medical_note", "travel_document", "booking_document", "other"]).parse(str(fd, "docType"));
    const f = await storeDocumentUpload(fd.get("file"));
    const [d] = await db.insert(s.documents).values({ ownerFamilyId: familyId, docType, fileName: f.fileName, mimeType: f.mime, sizeBytes: f.size, storageKey: f.key, sha256: f.sha256, scanStatus: f.scan, status: "approved", uploadedBy: u.id }).returning();
    await audit(u.id, "document.upload", "document", d.id, { docType, scan: f.scan });
    revalidatePath("/family/documents");
    return { ok: "Uploaded. Only your household and authorised Omega staff can open it." };
  });
}
export async function deleteFamilyDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { u, familyId } = await familyUser();
    const r = await db.delete(s.documents).where(and(eq(s.documents.id, str(fd, "documentId")), eq(s.documents.ownerFamilyId, familyId))).returning();
    if (!r.length) throw new DomainError("Document not found.");
    await audit(u.id, "document.delete", "document", r[0].id);
    revalidatePath("/family/documents");
    return { ok: "Deleted." };
  });
}
