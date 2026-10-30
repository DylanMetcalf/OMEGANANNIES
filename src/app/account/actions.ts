"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { assertUser, clientIp, destroySession } from "@/lib/auth";
import { DomainError } from "@/lib/bookings";
import { hashPassword, sha256, verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { bool, email, opt, password, run, str } from "@/lib/forms";
import { deliverPending, notify, sendEmailDirect } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import { issueToken } from "@/lib/tokens";
import { CATEGORIES, normalizePhone } from "@/lib/channels";
import { disconnect, syncIncoming } from "@/lib/calendar/sync";
import type { ActionResult } from "@/components/action-form";

/** Re-authentication for sensitive changes: the current password must be supplied. */
async function reauth(userId: string, pw: string) {
  if (!(await rateLimit(`reauth:${userId}`, 8, 900))) throw new DomainError("Too many attempts. Please wait 15 minutes.");
  const [row] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!(await verifyPassword(pw, row.passwordHash))) { await audit(userId, "auth.reauth_failed", "user", userId); throw new DomainError("Your current password is incorrect."); }
  return row;
}
const mask = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + "•".repeat(Math.min(6, b.length)) + c);

export async function saveProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const v = z.object({ name: z.string().trim().min(2, "Enter your name.").max(120), phone: z.string().trim().max(40).regex(/^[+\d\s()-]*$/, "Use digits, spaces and + only.") }).parse({ name: str(fd, "name"), phone: str(fd, "phone") });
    const phone = v.phone ? normalizePhone(v.phone) : null;
    if (v.phone && !phone) throw new DomainError("Enter a valid mobile number, e.g. 082 123 4567 or +27 82 123 4567.");
    const [cur] = await db.select({ phone: s.users.phone }).from(s.users).where(eq(s.users.id, u.id));
    await db.update(s.users).set({ name: v.name, phone, updatedAt: new Date() }).where(eq(s.users.id, u.id));
    // Consent to SMS/WhatsApp belongs to a specific number: a new number needs fresh consent.
    if (normalizePhone(cur?.phone) !== phone) await db.update(s.notificationPreferences).set({ smsConsentAt: null, whatsappConsentAt: null }).where(eq(s.notificationPreferences.userId, u.id));
    await audit(u.id, "account.profile_update", "user", u.id);
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    await reauth(u.id, str(fd, "current"));
    await db.update(s.users).set({ passwordHash: await hashPassword(password.parse(str(fd, "next"))), updatedAt: new Date() }).where(eq(s.users.id, u.id));
    await db.delete(s.sessions).where(and(eq(s.sessions.userId, u.id), ne(s.sessions.id, u.sessionId))); // sign out other devices
    await notify(u.id, "password_changed", {}, `pw:${Date.now()}`);
    void deliverPending();
    await audit(u.id, "auth.password_change", "user", u.id);
    return { ok: "Password changed. Other devices have been signed out." };
  });
}

/** Email change: re-authenticate, then confirm control of the NEW address before it becomes the login. */
export async function requestEmailChangeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    await reauth(u.id, str(fd, "current"));
    const next = email.parse(str(fd, "email"));
    if (next === u.email.toLowerCase()) throw new DomainError("That’s already your email address.");
    if (!(await rateLimit(`email-change:${u.id}`, 3, 3600))) throw new DomainError("Too many requests. Try again later.");
    const [taken] = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${next}`);
    let link = "";
    if (!taken) { // same response either way: no account enumeration
      const token = await issueToken("change_email", 1, { userId: u.id, email: next });
      link = `/confirm-email?token=${token}`;
      await sendEmailDirect(next, "Confirm your new email address", "Confirm this address to use it to sign in to Omega Nannies. The link expires in 1 hour.", link);
    }
    await audit(u.id, "account.email_change_requested", "user", u.id);
    return { ok: env.demo && link ? `Demo — email captured. Confirm here: ${link}` : `If ${next} can be used, we’ve sent a confirmation link to it. Your sign-in email changes once you confirm.` };
  });
}

export async function confirmEmailChangeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    if (!(await rateLimit(`confirm-email:${await clientIp()}`, 10, 900))) throw new DomainError("Too many attempts.");
    const [t] = await db.update(s.authTokens).set({ usedAt: new Date() })
      .where(and(eq(s.authTokens.kind, "change_email"), eq(s.authTokens.tokenHash, sha256(str(fd, "token"))), sql`${s.authTokens.usedAt} IS NULL`, sql`${s.authTokens.expiresAt} > now()`)).returning();
    if (!t?.userId || !t.email) throw new DomainError("This link is invalid or has expired.");
    const [old] = await db.select().from(s.users).where(eq(s.users.id, t.userId));
    const [taken] = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${t.email.toLowerCase()}`);
    if (taken) throw new DomainError("That address is no longer available.");
    await db.update(s.users).set({ email: t.email, emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(s.users.id, t.userId));
    await db.delete(s.sessions).where(eq(s.sessions.userId, t.userId)); // re-sign-in everywhere with the new address
    await sendEmailDirect(old.email, "Your sign-in email was changed", `The email address for your Omega Nannies account was changed to ${mask(t.email)}. If this wasn't you, contact Omega Nannies immediately.`);
    await audit(t.userId, "account.email_changed", "user", t.userId);
    return { ok: "changed" };
  });
  if (r?.ok) redirect("/login?email-changed=1");
  return r;
}

/** Channel matrix. Security notices aren't in it (always on); SMS/WhatsApp need a number and explicit consent. */
export async function savePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const [[me], [cur]] = await Promise.all([db.select({ phone: s.users.phone }).from(s.users).where(eq(s.users.id, u.id)), db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, u.id))]);
    const channels = Object.fromEntries(CATEGORIES.map((c) => [c, { email: bool(fd, `${c}_email`), sms: bool(fd, `${c}_sms`), whatsapp: bool(fd, `${c}_whatsapp`) }]));
    const wantsSms = CATEGORIES.some((c) => channels[c].sms), wantsWa = CATEGORIES.some((c) => channels[c].whatsapp);
    if ((wantsSms || wantsWa) && !normalizePhone(me?.phone)) throw new DomainError("Add a mobile number under Your details before choosing SMS or WhatsApp.");
    if (wantsSms && !cur?.smsConsentAt && !bool(fd, "smsConsent")) throw new DomainError("Please confirm you agree to receive SMS messages.");
    if (wantsWa && !cur?.whatsappConsentAt && !bool(fd, "whatsappConsent")) throw new DomainError("Please confirm you agree to receive WhatsApp messages.");
    const v = {
      channels, marketingOptIn: bool(fd, "marketingOptIn"),
      emailBookings: channels.bookings.email, emailMessages: channels.messages.email, emailReminders: channels.reminders.email,
      smsConsentAt: wantsSms ? (cur?.smsConsentAt ?? new Date()) : null, whatsappConsentAt: wantsWa ? (cur?.whatsappConsentAt ?? new Date()) : null,
    };
    await db.insert(s.notificationPreferences).values({ userId: u.id, ...v }).onConflictDoUpdate({ target: s.notificationPreferences.userId, set: v });
    await db.insert(s.consents).values([
      { userId: u.id, policy: "marketing", version: "2026-10", granted: v.marketingOptIn },
      ...(wantsSms !== !!cur?.smsConsentAt ? [{ userId: u.id, policy: "sms", version: "2026-10", granted: wantsSms }] : []),
      ...(wantsWa !== !!cur?.whatsappConsentAt ? [{ userId: u.id, policy: "whatsapp", version: "2026-10", granted: wantsWa }] : []),
    ]);
    revalidatePath("/account");
    return { ok: "Preferences saved." };
  });
}

export async function disconnectCalendarAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    if (!(await disconnect(u.id, str(fd, "id")))) throw new DomainError("Connection not found.");
    revalidatePath("/account");
    return { ok: "Calendar disconnected. Omega's events were removed from it." };
  });
}
export async function calendarPrefsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const r = await db.update(s.calendarConnections).set({ pushBookings: bool(fd, "pushBookings"), importBusy: bool(fd, "importBusy"), updatedAt: new Date() }).where(and(eq(s.calendarConnections.id, str(fd, "id")), eq(s.calendarConnections.userId, u.id))).returning();
    if (!r.length) throw new DomainError("Connection not found.");
    if (!r[0].importBusy) await db.delete(s.calendarBusyBlocks).where(eq(s.calendarBusyBlocks.connectionId, r[0].id));
    revalidatePath("/account");
    return { ok: "Calendar preferences saved." };
  });
}
export async function syncCalendarNowAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const [c] = await db.select().from(s.calendarConnections).where(and(eq(s.calendarConnections.id, str(fd, "id")), eq(s.calendarConnections.userId, u.id)));
    if (!c) throw new DomainError("Connection not found.");
    if (!(await rateLimit(`calendar:sync:${u.id}`, 6, 600))) throw new DomainError("Please wait a few minutes before syncing again.");
    const r = await syncIncoming(c.id).catch((e) => { throw new DomainError(`Sync failed: ${(e as Error).message}`); });
    revalidatePath("/account");
    return { ok: `Synced. ${r.busy} busy period${r.busy === 1 ? "" : "s"} protecting your availability.` };
  });
}

export async function privacyRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const kind = z.enum(["correction", "closure", "objection"]).parse(str(fd, "kind"));
    await db.insert(s.supportRequests).values({ userId: u.id, subject: `Privacy request: ${kind}`, body: opt(fd, "details")?.slice(0, 2000) ?? `User requested ${kind}.`, category: "privacy" });
    await audit(u.id, `privacy.request_${kind}`, "user", u.id);
    return { ok: "Request received. Omega will respond within the period POPIA requires." };
  });
}

export async function signOutOthersAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const r = await db.delete(s.sessions).where(and(eq(s.sessions.userId, u.id), ne(s.sessions.id, u.sessionId))).returning();
    await audit(u.id, "auth.sign_out_others", "user", u.id, { count: r.length });
    revalidatePath("/account");
    return { ok: `Signed out ${r.length} other session(s).` };
  });
}

export async function closeAccountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    const u = await assertUser();
    await reauth(u.id, str(fd, "current"));
    if (str(fd, "confirm") !== "CLOSE") throw new DomainError("Type CLOSE to confirm.");
    await db.update(s.users).set({ status: "closed", updatedAt: new Date() }).where(eq(s.users.id, u.id));
    await db.insert(s.supportRequests).values({ userId: u.id, subject: "Account closed — retention review", body: "User closed their account. Review records for deletion under the retention policy.", category: "privacy" });
    await audit(u.id, "account.closed", "user", u.id);
    await destroySession();
    return { ok: "closed" };
  });
  if (r?.ok) redirect("/login?closed=1");
  return r;
}
