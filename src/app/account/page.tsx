import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Notice, PageHeader, Section, type Tone } from "@/components/ui";
import { CATEGORIES, CATEGORY_LABEL, type ChannelPrefs } from "@/lib/channels";
import { provider, PROVIDERS } from "@/lib/calendar/providers";
import { providerStatus } from "@/lib/notify";
import { requireUser } from "@/lib/auth";
import { isManagement } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import * as A from "./actions";

export const metadata = { title: "Account" };
export default async function Account({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const u = await requireUser();
  const cal = (await searchParams).calendar;
  const [[row], [prefs], sessions, conns] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, u.id)),
    db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, u.id)),
    db.select().from(s.sessions).where(eq(s.sessions.userId, u.id)).orderBy(desc(s.sessions.lastSeenAt)),
    db.select({ id: s.calendarConnections.id, provider: s.calendarConnections.provider, accountEmail: s.calendarConnections.accountEmail, status: s.calendarConnections.status, pushBookings: s.calendarConnections.pushBookings, importBusy: s.calendarConnections.importBusy, lastSyncAt: s.calendarConnections.lastSyncAt, lastError: s.calendarConnections.lastError }).from(s.calendarConnections).where(eq(s.calendarConnections.userId, u.id)),
  ]);
  const isNanny = u.roles.includes("nanny");
  const ps = providerStatus();
  const chPrefs = (prefs?.channels ?? {}) as ChannelPrefs;
  const legacy = { bookings: prefs?.emailBookings ?? true, payments: prefs?.emailBookings ?? true, messages: prefs?.emailMessages ?? true, reminders: prefs?.emailReminders ?? true };
  const calMsg = { connected: ["ok", "Calendar connected. Confirmed bookings will appear in it."], denied: ["warn", "Calendar access wasn't granted."], failed: ["bad", "We couldn't connect your calendar. Please try again."], unavailable: ["warn", "Calendar connection isn't switched on by Omega yet."], busy: ["warn", "Too many attempts — try again later."] }[cal ?? ""] as [Tone, string] | undefined;
  const chk = (n: string, l: string, on: boolean) => <label className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" name={n} defaultChecked={on} className="h-4 w-4 accent-navy" />{l}</label>;
  return (
    <>
      <PageHeader eyebrow="Account" title="Account, security & privacy" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Your details">
          <ActionForm action={A.saveProfileAction} className="space-y-3">
            <div><label className="label" htmlFor="name">Full name</label><input id="name" name="name" defaultValue={row.name} autoComplete="name" className="input" /></div>
            <div><label className="label" htmlFor="phone">Mobile number</label><input id="phone" name="phone" type="tel" defaultValue={row.phone ?? ""} autoComplete="tel" className="input" /></div>
            <Submit>Save</Submit>
          </ActionForm>
        </Section>
        <Section title="Sign-in email" description={`Currently ${row.email}. We confirm the new address before switching.`}>
          <ActionForm action={A.requestEmailChangeAction} className="space-y-3" resetOnSuccess>
            <div><label className="label" htmlFor="new-email">New email address</label><input id="new-email" name="email" type="email" autoComplete="email" required className="input" /></div>
            <div><label className="label" htmlFor="pw-e">Current password</label><input id="pw-e" name="current" type="password" autoComplete="current-password" required className="input" /></div>
            <Submit className="btn-secondary">Send confirmation link</Submit>
          </ActionForm>
        </Section>
        <Section title="Password" description="Changing it signs you out of other devices.">
          <ActionForm action={A.changePasswordAction} className="space-y-3" resetOnSuccess>
            <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required className="input" /></div>
            <div><label className="label" htmlFor="next">New password</label><input id="next" name="next" type="password" minLength={10} autoComplete="new-password" required className="input" /></div>
            <Submit className="btn-secondary">Change password</Submit>
          </ActionForm>
          {isManagement(u) && <p className="mt-3 text-[13px] text-muted">Two-step verification: {row.mfaEnabled ? "on" : "off — set it up under Administration"}.</p>}
        </Section>
        <Section title="Notifications" description="Security and account notices always reach you by email and in the portal." className="lg:col-span-2">
          <ActionForm action={A.savePreferencesAction} className="space-y-4">
            <div tabIndex={0} role="region" aria-label="Notification channels" className="overflow-x-auto">
              <table className="tbl min-w-[520px]">
                <thead><tr><th>Type</th><th className="text-center">Email</th><th className="text-center">SMS</th><th className="text-center">WhatsApp</th></tr></thead>
                <tbody>
                  <tr><td>Account &amp; security</td><td className="text-center text-[13px] text-muted">Always</td><td className="text-center text-muted">—</td><td className="text-center text-muted">—</td></tr>
                  {CATEGORIES.map((c) => <tr key={c}><td>{CATEGORY_LABEL[c]}</td>{(["email", "sms", "whatsapp"] as const).map((ch) => <td key={ch} className="text-center"><input type="checkbox" name={`${c}_${ch}`} defaultChecked={chPrefs[c]?.[ch] ?? (ch === "email" ? legacy[c] : false)} aria-label={`${CATEGORY_LABEL[c]} by ${ch}`} className="h-4 w-4 accent-navy" /></td>)}</tr>)}
                </tbody>
              </table>
            </div>
            {!row.phone && <p className="text-[13px] text-muted">Add a mobile number under Your details to use SMS or WhatsApp.</p>}
            <div className="grid gap-2 text-[13px] sm:grid-cols-2">
              {!prefs?.smsConsentAt && <label className="flex gap-2"><input type="checkbox" name="smsConsent" className="mt-0.5 h-4 w-4 accent-navy" />I agree to receive service SMS from Omega Nannies at my mobile number. Reply STOP to opt out.</label>}
              {!prefs?.whatsappConsentAt && <label className="flex gap-2"><input type="checkbox" name="whatsappConsent" className="mt-0.5 h-4 w-4 accent-navy" />I agree to receive service WhatsApp messages from Omega Nannies.</label>}
            </div>
            {chk("marketingOptIn", "Occasional news and offers by email (optional, never required)", prefs?.marketingOptIn ?? false)}
            {(!ps.sms || !ps.whatsapp) && <p className="text-[12px] text-muted">{!ps.sms && !ps.whatsapp ? "SMS and WhatsApp" : !ps.sms ? "SMS" : "WhatsApp"} delivery is not switched on by Omega yet — your choice is saved for when it is.</p>}
            <Submit className="btn-secondary">Save preferences</Submit>
          </ActionForm>
        </Section>
        <Section title="Calendar" description={isNanny ? "Confirmed bookings appear in your calendar. Busy times in your calendar can protect your availability — only start and end times are read, never titles or details." : "Add your confirmed bookings to your own calendar automatically."} className="lg:col-span-2">
          <div id="calendar" />
          {calMsg && <div className="mb-4"><Notice tone={calMsg[0]}>{calMsg[1]}</Notice></div>}
          <ul className="space-y-3">
            {PROVIDERS.map((p) => {
              const c = conns.find((x) => x.provider === p);
              const prov = provider(p);
              return (
                <li key={p} className="rounded-[12px] border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-semibold text-ink">{prov.label}</p><p className="text-[13px] text-muted">{c ? `${c.accountEmail ?? "Connected"}${c.lastSyncAt ? ` · last synced ${fmtDateTime(c.lastSyncAt)}` : ""}` : prov.configured() ? "Not connected" : "Not available yet — Omega hasn't switched this on"}</p></div>
                    <div className="flex items-center gap-2">
                      {c && <Badge tone={c.status === "active" ? "ok" : "warn"}>{c.status === "active" ? "Connected" : c.status === "needs_reauth" ? "Reconnect needed" : c.status}</Badge>}
                      {(!c || c.status !== "active") && prov.configured() && <a href={`/api/calendar/connect/${p}`} className="btn-secondary btn-sm">{c ? "Reconnect" : "Connect"}</a>}
                    </div>
                  </div>
                  {c?.lastError && <p className="mt-2 text-[13px] text-warn">{c.lastError}</p>}
                  {c && (
                    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
                      <ActionForm action={A.calendarPrefsAction} className="flex flex-wrap items-center gap-4 text-[14px]">
                        <input type="hidden" name="id" value={c.id} />
                        <label className="flex items-center gap-2"><input type="checkbox" name="pushBookings" defaultChecked={c.pushBookings} className="h-4 w-4 accent-navy" />Add my bookings</label>
                        {isNanny && <label className="flex items-center gap-2"><input type="checkbox" name="importBusy" defaultChecked={c.importBusy} className="h-4 w-4 accent-navy" />Use my busy times for availability</label>}
                        <Submit className="btn-ghost btn-sm">Save</Submit>
                      </ActionForm>
                      <ActionForm action={A.syncCalendarNowAction}><input type="hidden" name="id" value={c.id} /><Submit className="btn-ghost btn-sm" pendingText="Syncing…">Sync now</Submit></ActionForm>
                      <ActionForm action={A.disconnectCalendarAction} confirm="Disconnect this calendar? Omega's events will be removed from it."><input type="hidden" name="id" value={c.id} /><Submit className="btn-ghost btn-sm text-bad" pendingText="Disconnecting…">Disconnect</Submit></ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12px] text-muted">Changes you make to an Omega booking inside your calendar don&rsquo;t change the booking — Omega is notified and will follow up. To change a booking, message us.</p>
        </Section>
        <Section title="Where you’re signed in">
          <ul className="mb-4 space-y-2 text-[13px]">{sessions.map((x) => <li key={x.id} className="flex justify-between gap-3"><span className="truncate text-muted">{x.userAgent?.replace(/\(.*?\)/g, "").slice(0, 60) ?? "Unknown device"}</span><span className="shrink-0">{x.id === u.sessionId ? <b>This device</b> : fmtDateTime(x.lastSeenAt)}</span></li>)}</ul>
          {sessions.length > 1 && <ActionForm action={A.signOutOthersAction}><Submit className="btn-secondary btn-sm">Sign out other devices</Submit></ActionForm>}
        </Section>
        <Section title="Your data (POPIA)" description="Download a copy of your information, ask for a correction, or close your account.">
          <a href="/api/account/export" className="btn-secondary" download>Download my data (JSON)</a>
          <ActionForm action={A.privacyRequestAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[160px_1fr]">
            <select name="kind" aria-label="Request type" className="input"><option value="correction">Correct my data</option><option value="objection">Object to processing</option></select>
            <input name="details" aria-label="Details" placeholder="What should we change?" className="input" />
            <div className="sm:col-span-2"><Submit className="btn-secondary btn-sm">Send request</Submit></div>
          </ActionForm>
          <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-[14px] font-medium text-bad">Close my account</summary>
            <ActionForm action={A.closeAccountAction} className="mt-3 space-y-3">
              <p className="text-[13px] text-muted">You’ll be signed out and can’t sign in again. Records Omega must keep by law (such as invoices) are retained; everything else is reviewed for deletion.</p>
              <input name="current" type="password" required placeholder="Current password" aria-label="Current password" autoComplete="current-password" className="input" />
              <input name="confirm" required placeholder="Type CLOSE" aria-label="Type CLOSE to confirm" className="input" />
              <Submit className="btn-danger">Close account</Submit>
            </ActionForm>
          </details>
        </Section>
      </div>
    </>
  );
}
