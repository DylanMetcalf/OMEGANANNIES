import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isManagement } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import * as A from "./actions";

export const metadata = { title: "Account" };
export default async function Account() {
  const u = await requireUser();
  const [[row], [prefs], sessions] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, u.id)),
    db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, u.id)),
    db.select().from(s.sessions).where(eq(s.sessions.userId, u.id)).orderBy(desc(s.sessions.lastSeenAt)),
  ]);
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
        <Section title="Notifications" description="Account and security emails are always sent.">
          <ActionForm action={A.savePreferencesAction} className="space-y-3">
            {chk("emailBookings", "Bookings, quotes and payments", prefs?.emailBookings ?? true)}
            {chk("emailMessages", "New messages", prefs?.emailMessages ?? true)}
            {chk("emailReminders", "Reminders (introductions, documents)", prefs?.emailReminders ?? true)}
            {chk("marketingOptIn", "Occasional news and offers (optional)", prefs?.marketingOptIn ?? false)}
            <Submit className="btn-secondary">Save preferences</Submit>
          </ActionForm>
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
