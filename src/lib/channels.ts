/**
 * Notification channels and preferences (pure, unit-tested).
 * Security/account notices always go to in-app + email and cannot be switched off. Marketing is opt-in only.
 * SMS and WhatsApp need a valid mobile number AND recorded consent for that channel.
 */
export const CATEGORIES = ["bookings", "reminders", "payments", "messages"] as const;
export type Category = (typeof CATEGORIES)[number] | "security" | "marketing";
export type Channel = "email" | "sms" | "whatsapp";
export type ChannelPrefs = Partial<Record<(typeof CATEGORIES)[number], Partial<Record<Channel, boolean>>>>;
export const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = { bookings: "Booking updates", reminders: "Reminders before care", payments: "Payments & receipts", messages: "New messages" };

/** E.164 normalisation with South Africa (+27) as the default country. Returns null when the number can't be valid. */
export function normalizePhone(raw: string | null | undefined, defaultCc = "27"): string | null {
  if (!raw) return null;
  let d = raw.trim().replace(/[\s().-]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("0")) d = `+${defaultCc}${d.slice(1)}`;
  if (!d.startsWith("+")) d = `+${d}`;
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}

export type PrefRow = { emailBookings: boolean; emailMessages: boolean; emailReminders: boolean; marketingOptIn: boolean; channels: unknown; smsConsentAt: Date | null; whatsappConsentAt: Date | null } | undefined;
/** Which external channels a notification of this category may use for this user right now. */
export function channelsFor(cat: Category, pref: PrefRow, phone: string | null): Channel[] {
  if (cat === "security") return ["email"];
  if (cat === "marketing") return pref?.marketingOptIn ? ["email"] : [];
  const ch = ((pref?.channels ?? {}) as ChannelPrefs)[cat] ?? {};
  const legacyEmail = !pref ? true : cat === "bookings" || cat === "payments" ? pref.emailBookings : cat === "messages" ? pref.emailMessages : pref.emailReminders;
  const out: Channel[] = [];
  if (ch.email ?? legacyEmail) out.push("email");
  const mobile = normalizePhone(phone);
  if (mobile && ch.sms && pref?.smsConsentAt) out.push("sms");
  if (mobile && ch.whatsapp && pref?.whatsappConsentAt) out.push("whatsapp");
  return out;
}
/** Retry schedule for failed sends: 1, 2, 4, 8 minutes … capped at 5 attempts in total. */
export const retryDue = (attempts: number, lastAttempt: Date, now = new Date()) => attempts < 5 && now.getTime() - lastAttempt.getTime() >= 60_000 * 2 ** Math.max(0, attempts - 1);
