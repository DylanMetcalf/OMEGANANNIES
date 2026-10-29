"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser } from "@/lib/auth";
import { acceptQuotation, bookingAccess, createBookingRequest, DomainError, familyIdsOf, transition } from "@/lib/bookings";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { bool, list, opt, password, run, str } from "@/lib/forms";
import { parseMoney } from "@/lib/money";
import { deliverPending } from "@/lib/notify";
import { startPayment } from "@/lib/payments/service";
import { hhmmToMinutes } from "@/lib/time";
import { issueToken } from "@/lib/tokens";
import { env } from "@/lib/env";
import type { ActionResult } from "@/components/action-form";

async function familyUser() {
  const u = await assertUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  if (!familyId) throw new DomainError("No household is linked to your account.");
  return { u, familyId };
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.");

export async function requestBookingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const { u, familyId } = await familyUser();
    const startDate = date.parse(str(fd, "startDate"));
    const endDate = date.parse(str(fd, "endDate") || startDate);
    const liveIn = str(fd, "serviceCode") === "live_in";
    const b = await createBookingRequest(u, {
      familyId, serviceCode: z.string().min(1, "Choose a service.").parse(str(fd, "serviceCode")), startDate, endDate,
      dailyStartMinute: liveIn ? 480 : hhmmToMinutes(str(fd, "startTime") || "09:00"), dailyEndMinute: liveIn ? 480 : hhmmToMinutes(str(fd, "endTime") || "17:00"),
      serviceLocationId: opt(fd, "serviceLocationId"), childIds: list(fd, "childIds"), requestedNannyId: opt(fd, "requestedNannyId"), liveIn,
      overnight: bool(fd, "overnight"), needsDriver: bool(fd, "needsDriver"), requiredLanguages: list(fd, "languages"), specialistCare: bool(fd, "specialistCare"),
      budgetMaxMinor: str(fd, "budget") ? parseMoney(str(fd, "budget")) : null, specialRequests: opt(fd, "specialRequests")?.slice(0, 2000) ?? null,
      idempotencyKey: z.string().uuid().parse(str(fd, "idempotencyKey")), termsAccepted: bool(fd, "terms"),
    });
    void deliverPending();
    id = b.id;
    return { ok: "Request sent" };
  });
  if (id) redirect(`/family/bookings/${id}?new=1`);
  return r;
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

export async function toggleFavouriteAction(fd: FormData) {
  const { familyId } = await familyUser();
  const nannyId = str(fd, "nannyId");
  const [n] = await db.select().from(s.nannies).where(and(eq(s.nannies.id, nannyId), eq(s.nannies.status, "approved"), eq(s.nannies.published, true)));
  if (!n) return;
  const [f] = await db.select().from(s.favourites).where(and(eq(s.favourites.familyId, familyId), eq(s.favourites.nannyId, nannyId)));
  if (f) await db.delete(s.favourites).where(and(eq(s.favourites.familyId, familyId), eq(s.favourites.nannyId, nannyId)));
  else await db.insert(s.favourites).values({ familyId, nannyId });
  revalidatePath("/family", "layout");
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
    revalidatePath("/family/children");
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
    revalidatePath("/family/children");
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
    revalidatePath("/family/profile");
    return { ok: "Household details saved." };
  });
}
export async function addLocationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { familyId } = await familyUser();
    const v = z.object({ label: z.string().min(1, "Add a label.").max(60), area: z.string().min(1, "Choose an area."), addressLine: z.string().max(300).nullable(), accessNotes: z.string().max(500).nullable() })
      .parse({ label: str(fd, "label"), area: str(fd, "area"), addressLine: opt(fd, "addressLine"), accessNotes: opt(fd, "accessNotes") });
    await db.insert(s.serviceLocations).values({ ...v, familyId });
    revalidatePath("/family/profile");
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

export async function savePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const v = { emailBookings: bool(fd, "emailBookings"), emailMessages: bool(fd, "emailMessages"), emailReminders: bool(fd, "emailReminders"), marketingOptIn: bool(fd, "marketingOptIn") };
    await db.insert(s.notificationPreferences).values({ userId: u.id, ...v }).onConflictDoUpdate({ target: s.notificationPreferences.userId, set: v });
    await db.insert(s.consents).values({ userId: u.id, policy: "marketing", version: "2026-10", granted: v.marketingOptIn });
    return { ok: "Preferences saved." };
  });
}
export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    if (!(await verifyPassword(str(fd, "current"), row.passwordHash))) throw new DomainError("Your current password is incorrect.");
    await db.update(s.users).set({ passwordHash: await hashPassword(password.parse(str(fd, "next"))) }).where(eq(s.users.id, u.id));
    await audit(u.id, "auth.password_change", "user", u.id);
    return { ok: "Password changed." };
  });
}
export async function privacyRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const kind = z.enum(["export", "correction", "closure"]).parse(str(fd, "kind"));
    await db.insert(s.supportRequests).values({ userId: u.id, subject: `Privacy request: ${kind}`, body: opt(fd, "details") ?? `User requested data ${kind}.`, category: "privacy" });
    await audit(u.id, `privacy.request_${kind}`, "user", u.id);
    return { ok: "Request received. We'll respond within the period required by POPIA (usually 30 days)." };
  });
}
export async function markNotificationsReadAction() {
  const u = await assertUser();
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app")));
  revalidatePath("/", "layout");
}
