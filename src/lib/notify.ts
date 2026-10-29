import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Tx, schema as s } from "@/db";
import { env } from "./env";

type Vars = Record<string, string>;
type Category = "bookings" | "messages" | "reminders" | "account";
const TEMPLATES: Record<string, { category: Category; subject: (v: Vars) => string; body: (v: Vars) => string }> = {
  invite: { category: "account", subject: () => "You're invited to Omega Nannies", body: (v) => `${v.inviter} has invited you to join the Omega Nannies portal as ${v.role}. This invitation expires in 7 days.` },
  verify_email: { category: "account", subject: () => "Confirm your email address", body: () => "Please confirm your email address to finish setting up your Omega Nannies account. This link expires in 24 hours." },
  reset_password: { category: "account", subject: () => "Reset your password", body: () => "We received a request to reset your password. This link expires in 1 hour. If you didn't ask for this, you can ignore this email." },
  booking_received: { category: "bookings", subject: (v) => `We've received your request ${v.ref}`, body: (v) => `Thank you. Your request ${v.ref} is with our team and we'll respond within 4 hours. Nothing is confirmed until you receive a confirmation from us.` },
  booking_new_enquiry: { category: "bookings", subject: (v) => `New booking request ${v.ref}`, body: (v) => `${v.family} submitted ${v.ref} for ${v.service}, ${v.dates}.` },
  quote_ready: { category: "bookings", subject: (v) => `Your quotation for ${v.ref} is ready`, body: (v) => `Your quotation of ${v.total} for ${v.ref} is ready to review. A deposit of ${v.deposit} confirms the booking once paid.` },
  booking_declined: { category: "bookings", subject: (v) => `Update on ${v.ref}`, body: (v) => `We're sorry — we're unable to accommodate ${v.ref}. ${v.note ?? ""}` },
  payment_received: { category: "bookings", subject: (v) => `Payment received for ${v.ref}`, body: (v) => `We've received ${v.amount} for ${v.ref}. Your booking is confirmed.` },
  booking_confirmed_nanny: { category: "bookings", subject: (v) => `New confirmed booking ${v.ref}`, body: (v) => `You have been booked for ${v.ref} (${v.dates}). Full care instructions are in your portal.` },
  booking_cancelled: { category: "bookings", subject: (v) => `${v.ref} has been cancelled`, body: (v) => `Booking ${v.ref} has been cancelled. ${v.note ?? ""}` },
  booking_rescheduled: { category: "bookings", subject: (v) => `${v.ref} has new dates`, body: (v) => `Booking ${v.ref} now runs ${v.dates}.` },
  booking_completed: { category: "bookings", subject: (v) => `How was your time with ${v.nanny}?`, body: (v) => `Booking ${v.ref} is complete. We'd love your feedback — it takes a minute.` },
  meeting_scheduled: { category: "reminders", subject: (v) => `Introduction scheduled for ${v.ref}`, body: (v) => `An introduction call is scheduled for ${v.when}. ${v.link ? "Join: " + v.link : ""}` },
  new_message: { category: "messages", subject: (v) => `New message: ${v.subject}`, body: (v) => `${v.sender} sent you a message in the Omega Nannies portal.` },
  document_expiring: { category: "reminders", subject: (v) => `${v.doc} expires ${v.when}`, body: (v) => `Your ${v.doc} expires on ${v.when}. Please upload a renewed copy so you stay bookable.` },
  document_reviewed: { category: "account", subject: (v) => `Document ${v.status}`, body: (v) => `Your ${v.doc} was ${v.status}. ${v.note ?? ""}` },
  profile_change_decided: { category: "account", subject: (v) => `Profile change ${v.status}`, body: (v) => `Your requested change to "${v.field}" was ${v.status}.` },
  booking_offer: { category: "bookings", subject: (v) => `New booking offer ${v.ref}`, body: (v) => `Omega would like to offer you ${v.ref} (${v.service}, ${v.dates}, ${v.area}). Please accept or decline in your portal.` },
  nanny_response: { category: "bookings", subject: (v) => `${v.nanny} ${v.response} ${v.ref}`, body: (v) => `${v.nanny} has ${v.response} the offer for ${v.ref}. ${v.note ?? ""}` },
  email_changed: { category: "account", subject: () => "Your sign-in email was changed", body: (v) => `The email address for your Omega Nannies account was changed to ${v.masked}. If this wasn't you, contact Omega Nannies immediately.` },
  password_changed: { category: "account", subject: () => "Your password was changed", body: () => "Your Omega Nannies password was changed and other devices were signed out. If this wasn't you, reset your password and contact us." },
  support_update: { category: "account", subject: (v) => `Support request: ${v.subject}`, body: (v) => `Your support request has been updated: ${v.status}.` },
};

/**
 * Queue an in-app + email notification. Idempotent per (user, channel, dedupeKey): replays of the same
 * business event never produce duplicates.
 */
export async function notify(userId: string, template: keyof typeof TEMPLATES, vars: Vars, dedupeKey: string, link?: string, tx?: Tx) {
  const t = TEMPLATES[template];
  const subject = t.subject(vars), body = t.body(vars);
  const q = tx ?? db;
  const [pref] = await q.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, userId));
  const emailOn = t.category === "account" || !pref || (t.category === "bookings" ? pref.emailBookings : t.category === "messages" ? pref.emailMessages : pref.emailReminders);
  const rows = [{ userId, dedupeKey, channel: "in_app", template, subject, body, link, status: "sent", sentAt: new Date() }];
  if (emailOn) rows.push({ userId, dedupeKey, channel: "email", template, subject, body, link, status: "pending", sentAt: null as unknown as Date });
  await q.insert(s.notifications).values(rows).onConflictDoNothing();
}

export async function notifyMany(userIds: string[], template: keyof typeof TEMPLATES, vars: Vars, dedupeKey: string, link?: string, tx?: Tx) {
  for (const u of new Set(userIds)) await notify(u, template, vars, dedupeKey, link, tx);
}

export function emailHtml(subject: string, body: string, link?: string | null) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const href = link ? (link.startsWith("http") ? link : env.appUrl + link) : null;
  return `<div style="background:#f7f3ee;padding:32px;font-family:'DM Sans',Arial,sans-serif;color:#2c3347"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #ede5d8"><div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;color:#1a2340;letter-spacing:.04em">OMEGA NANNIES</div><hr style="border:none;border-top:1px solid #c8922a;width:48px;margin:12px 0 24px"/><h1 style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;color:#1a2340;font-size:22px">${esc(subject)}</h1><p style="line-height:1.6">${esc(body)}</p>${href ? `<p><a href="${esc(href)}" style="display:inline-block;background:#1a2340;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Open portal</a></p>` : ""}<p style="font-size:12px;color:#6b7280;margin-top:32px">This is an operational message about your Omega Nannies account. Manage notification preferences in your portal settings.</p></div></div>`;
}

/** Deliver pending emails with retry/backoff. In demo mode or without a provider, emails are captured, not sent. */
export async function deliverPending(limit = 25) {
  const pending = await db.select({ n: s.notifications, email: s.users.email, isDemo: s.users.isDemo }).from(s.notifications)
    .innerJoin(s.users, eq(s.users.id, s.notifications.userId))
    .where(and(eq(s.notifications.channel, "email"), inArray(s.notifications.status, ["pending", "failed"]), lt(s.notifications.attempts, 5)))
    .orderBy(s.notifications.createdAt).limit(limit);
  for (const { n, email, isDemo } of pending) {
    if (env.demo || isDemo || !env.resendKey) {
      await db.update(s.notifications).set({ status: "captured", sentAt: new Date() }).where(eq(s.notifications.id, n.id));
      continue;
    }
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": n.id },
        body: JSON.stringify({ from: env.emailFrom, to: [email], subject: n.subject, html: emailHtml(n.subject, n.body, n.link) }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await db.update(s.notifications).set({ status: "sent", sentAt: new Date(), attempts: sql`${s.notifications.attempts} + 1` }).where(eq(s.notifications.id, n.id));
    } catch (e) {
      await db.update(s.notifications).set({ status: "failed", lastError: String(e).slice(0, 500), attempts: sql`${s.notifications.attempts} + 1` }).where(eq(s.notifications.id, n.id));
    }
  }
  return pending.length;
}

/**
 * Send an operational email to an address that may not have an account yet (e.g. a nanny invitation or email-change
 * confirmation). Returns the real delivery outcome; in demo mode or without a provider the email is captured, not sent.
 */
export async function sendEmailDirect(to: string, subject: string, body: string, link?: string): Promise<"sent" | "captured" | "failed"> {
  if (env.demo || !env.resendKey) return "captured";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, html: emailHtml(subject, body, link) }), signal: AbortSignal.timeout(10000),
    });
    return r.ok ? "sent" : "failed";
  } catch { return "failed"; }
}
