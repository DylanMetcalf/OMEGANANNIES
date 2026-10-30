import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Tx, schema as s } from "@/db";
import { env } from "./env";
import { channelsFor, normalizePhone, retryDue, type Category } from "./channels";

type Vars = Record<string, string>;
type T = { category: Category; subject: (v: Vars) => string; body: (v: Vars) => string; sms?: (v: Vars) => string };
/**
 * Message templates. Bodies are short and reassuring and never include addresses, children's details, identity
 * information or payment credentials. SMS/WhatsApp texts are even shorter and always point back to the portal.
 */
const TEMPLATES: Record<string, T> = {
  invite: { category: "security", subject: () => "You're invited to Omega Nannies", body: (v) => `${v.inviter} has invited you to join the Omega Nannies portal as ${v.role}. This invitation expires in 7 days.` },
  verify_email: { category: "security", subject: () => "Confirm your email address", body: () => "Please confirm your email address to finish setting up your Omega Nannies account. This link expires in 24 hours." },
  reset_password: { category: "security", subject: () => "Reset your password", body: () => "We received a request to reset your password. This link expires in 1 hour. If you didn't ask for this, you can ignore this email." },
  booking_received: { category: "bookings", subject: (v) => `We've received your request ${v.ref}`, body: (v) => `Thank you. Your request ${v.ref} is with our team and we'll respond within 4 hours. Nothing is confirmed until you receive a confirmation from us.`, sms: (v) => `Omega Nannies: we've received your request ${v.ref} and will reply within 4 hours.` },
  booking_new_enquiry: { category: "bookings", subject: (v) => `New booking request ${v.ref}`, body: (v) => `${v.family} submitted ${v.ref} for ${v.service}, ${v.dates}.` },
  quote_ready: { category: "bookings", subject: (v) => `Your quotation for ${v.ref} is ready`, body: (v) => `Your quotation of ${v.total} for ${v.ref} is ready to review. A deposit of ${v.deposit} confirms the booking once paid.`, sms: (v) => `Omega Nannies: your quotation for ${v.ref} is ready to review in your portal.` },
  booking_declined: { category: "bookings", subject: (v) => `Update on ${v.ref}`, body: (v) => `We're sorry — we're unable to accommodate ${v.ref}. ${v.note ?? ""}`, sms: (v) => `Omega Nannies: there's an update on ${v.ref}. Please check your portal.` },
  payment_received: { category: "payments", subject: (v) => `Payment received for ${v.ref}`, body: (v) => `We've received ${v.amount} for ${v.ref}. Your booking is confirmed.`, sms: (v) => `Omega Nannies: payment received — ${v.ref} is confirmed.` },
  booking_confirmed_nanny: { category: "bookings", subject: (v) => `New confirmed booking ${v.ref}`, body: (v) => `You have been booked for ${v.ref} (${v.dates}). Full care instructions are in your portal.`, sms: (v) => `Omega Nannies: ${v.ref} (${v.dates}) is confirmed. Details are in your portal.` },
  booking_cancelled: { category: "bookings", subject: (v) => `${v.ref} has been cancelled`, body: (v) => `Booking ${v.ref} has been cancelled. ${v.note ?? ""}`, sms: (v) => `Omega Nannies: booking ${v.ref} has been cancelled.` },
  booking_rescheduled: { category: "bookings", subject: (v) => `${v.ref} has new dates`, body: (v) => `Booking ${v.ref} now runs ${v.dates}.`, sms: (v) => `Omega Nannies: ${v.ref} now runs ${v.dates}.` },
  booking_completed: { category: "bookings", subject: (v) => `How was your time with ${v.nanny}?`, body: (v) => `Booking ${v.ref} is complete. We'd love your feedback — it takes a minute.` },
  booking_reminder: { category: "reminders", subject: (v) => `Reminder: ${v.ref} starts ${v.when}`, body: (v) => `A reminder that ${v.ref} starts ${v.when}. Everything you need is in your portal.`, sms: (v) => `Omega Nannies reminder: ${v.ref} starts ${v.when}.` },
  meeting_scheduled: { category: "reminders", subject: (v) => `Introduction scheduled for ${v.ref}`, body: (v) => `An introduction call is scheduled for ${v.when}. ${v.link ? "Join: " + v.link : ""}`, sms: (v) => `Omega Nannies: introduction for ${v.ref} on ${v.when}.` },
  new_message: { category: "messages", subject: (v) => `New message: ${v.subject}`, body: (v) => `${v.sender} sent you a message in the Omega Nannies portal.`, sms: () => "Omega Nannies: you have a new message in your portal." },
  document_expiring: { category: "reminders", subject: (v) => `${v.doc} expires ${v.when}`, body: (v) => `Your ${v.doc} expires on ${v.when}. Please upload a renewed copy so you stay bookable.`, sms: (v) => `Omega Nannies: your ${v.doc} expires ${v.when}. Please upload a renewed copy.` },
  document_required: { category: "security", subject: (v) => `Please upload your ${v.doc}`, body: (v) => `To complete your Omega profile we need your ${v.doc}. Upload it securely in your portal.` },
  document_reviewed: { category: "security", subject: (v) => `Document ${v.status}`, body: (v) => `Your ${v.doc} was ${v.status}. ${v.note ?? ""}` },
  profile_change_decided: { category: "security", subject: (v) => `Profile change ${v.status}`, body: (v) => `Your requested change to "${v.field}" was ${v.status}.` },
  booking_offer: { category: "bookings", subject: (v) => `New booking offer ${v.ref}`, body: (v) => `Omega would like to offer you ${v.ref} (${v.service}, ${v.dates}, ${v.area}). Please accept or decline in your portal.`, sms: (v) => `Omega Nannies: new booking offer ${v.ref} (${v.dates}). Please respond in your portal.` },
  nanny_response: { category: "bookings", subject: (v) => `${v.nanny} ${v.response} ${v.ref}`, body: (v) => `${v.nanny} has ${v.response} the offer for ${v.ref}. ${v.note ?? ""}` },
  email_changed: { category: "security", subject: () => "Your sign-in email was changed", body: (v) => `The email address for your Omega Nannies account was changed to ${v.masked}. If this wasn't you, contact Omega Nannies immediately.` },
  password_changed: { category: "security", subject: () => "Your password was changed", body: () => "Your Omega Nannies password was changed and other devices were signed out. If this wasn't you, reset your password and contact us." },
  support_update: { category: "security", subject: (v) => `Support request: ${v.subject}`, body: (v) => `Your support request has been updated: ${v.status}.` },
};
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Queue a notification: always in-app, plus each external channel the user's preferences allow. Idempotent per
 * (user, channel, dedupeKey): replays of the same business event never produce duplicates.
 */
export async function notify(userId: string, template: keyof typeof TEMPLATES, vars: Vars, dedupeKey: string, link?: string, tx?: Tx) {
  const t = TEMPLATES[template];
  const subject = t.subject(vars), body = t.body(vars);
  const q = tx ?? db;
  const [[pref], [user]] = await Promise.all([
    q.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, userId)),
    q.select({ phone: s.users.phone }).from(s.users).where(eq(s.users.id, userId)),
  ]);
  const rows: (typeof s.notifications.$inferInsert)[] = [{ userId, dedupeKey, channel: "in_app", template, subject, body, link, status: "delivered", sentAt: new Date(), deliveredAt: new Date() }];
  for (const ch of channelsFor(t.category, pref, user?.phone ?? null)) {
    if (ch !== "email" && !t.sms) continue; // only templates written for short channels go to SMS/WhatsApp
    rows.push({ userId, dedupeKey, channel: ch, template, subject, body: ch === "email" ? body : t.sms!(vars), link, status: "pending" });
  }
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

const twilio = () => ({ sid: process.env.TWILIO_ACCOUNT_SID || "", token: process.env.TWILIO_AUTH_TOKEN || "", smsFrom: process.env.TWILIO_SMS_FROM || "", service: process.env.TWILIO_MESSAGING_SERVICE_SID || "", waFrom: process.env.TWILIO_WHATSAPP_FROM || "" });
export const providerStatus = () => ({ email: !!env.resendKey, sms: !!(twilio().sid && twilio().token && (twilio().smsFrom || twilio().service)), whatsapp: !!(twilio().sid && twilio().token && twilio().waFrom) });

/**
 * Deliver queued email/SMS/WhatsApp with retry and backoff (1, 2, 4, 8 min; 5 attempts). "sent" means the provider
 * accepted the message; only the provider's signed delivery callback marks it "delivered". In demo mode, or without
 * a configured provider, messages are "captured" (recorded, not sent) so nothing is ever falsely reported as delivered.
 */
export async function deliverPending(limit = 25) {
  const now = new Date();
  const pending = await db.select({ n: s.notifications, email: s.users.email, phone: s.users.phone, isDemo: s.users.isDemo }).from(s.notifications)
    .innerJoin(s.users, eq(s.users.id, s.notifications.userId))
    .where(and(inArray(s.notifications.channel, ["email", "sms", "whatsapp"]), inArray(s.notifications.status, ["pending", "failed"]), lt(s.notifications.attempts, 5)))
    .orderBy(s.notifications.createdAt).limit(limit);
  const ps = providerStatus();
  let processed = 0;
  for (const { n, email, phone, isDemo } of pending) {
    if (n.status === "failed" && !retryDue(n.attempts, n.lastAttemptAt ?? n.createdAt, now)) continue;
    processed++;
    const ch = n.channel as "email" | "sms" | "whatsapp";
    if (env.demo || isDemo || !ps[ch]) { await db.update(s.notifications).set({ status: "captured", sentAt: now, lastError: env.demo || isDemo ? null : `${ch} provider not configured` }).where(eq(s.notifications.id, n.id)); continue; }
    const mobile = normalizePhone(phone);
    if (ch !== "email" && !mobile) { await db.update(s.notifications).set({ status: "skipped", lastError: "No valid mobile number" }).where(eq(s.notifications.id, n.id)); continue; }
    try {
      let ref: string;
      if (ch === "email") {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": n.id },
          body: JSON.stringify({ from: env.emailFrom, to: [email], subject: n.subject, html: emailHtml(n.subject, n.body, n.link) }), signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
        ref = ((await r.json()) as { id: string }).id;
      } else {
        const tw = twilio();
        const link = n.link ? ` ${n.link.startsWith("http") ? n.link : env.appUrl + n.link}` : "";
        const params = new URLSearchParams({ To: ch === "whatsapp" ? `whatsapp:${mobile}` : mobile!, Body: `${n.body}${link}`.slice(0, 1500), StatusCallback: `${env.appUrl}/api/notifications/twilio` });
        if (ch === "whatsapp") params.set("From", `whatsapp:${tw.waFrom}`); else if (tw.service) params.set("MessagingServiceSid", tw.service); else params.set("From", tw.smsFrom);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tw.sid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${tw.sid}:${tw.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`Twilio ${r.status}: ${(await r.text()).slice(0, 200)}`);
        ref = ((await r.json()) as { sid: string }).sid;
      }
      await db.update(s.notifications).set({ status: "sent", providerRef: ref, sentAt: new Date(), lastAttemptAt: new Date(), attempts: sql`${s.notifications.attempts} + 1`, lastError: null }).where(eq(s.notifications.id, n.id));
    } catch (e) {
      await db.update(s.notifications).set({ status: "failed", lastError: String(e).slice(0, 500), lastAttemptAt: new Date(), attempts: sql`${s.notifications.attempts} + 1` }).where(eq(s.notifications.id, n.id));
    }
  }
  return processed;
}

/** Apply a provider delivery callback (already signature-verified). Never moves a message backwards from delivered. */
export async function applyDeliveryStatus(providerRef: string, status: "delivered" | "failed", error?: string) {
  const set = status === "delivered" ? { status: "delivered", deliveredAt: new Date(), lastError: null } : { status: "failed", lastError: (error ?? "Provider reported failure").slice(0, 300), attempts: 5 };
  const r = await db.update(s.notifications).set(set).where(and(eq(s.notifications.providerRef, providerRef), sql`${s.notifications.status} <> 'delivered'`)).returning({ id: s.notifications.id });
  return r.length;
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
