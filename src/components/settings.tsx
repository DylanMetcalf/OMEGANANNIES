import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Section } from "@/components/ui";
import { changePasswordAction, privacyRequestAction, savePreferencesAction } from "@/app/family/actions";

export async function SettingsBody({ userId }: { userId: string }) {
  const [p] = await db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, userId));
  const chk = (n: string, l: string, on: boolean) => <label className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" name={n} defaultChecked={on} className="accent-navy" />{l}</label>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Notifications">
        <ActionForm action={savePreferencesAction} className="space-y-3">
          {chk("emailBookings", "Email me about bookings, quotes and payments", p?.emailBookings ?? true)}
          {chk("emailMessages", "Email me about new messages", p?.emailMessages ?? true)}
          {chk("emailReminders", "Email reminders (introductions, documents)", p?.emailReminders ?? true)}
          {chk("marketingOptIn", "Occasional news and offers (optional)", p?.marketingOptIn ?? false)}
          <p className="text-[12px] text-muted">Account and security emails are always sent.</p>
          <Submit>Save preferences</Submit>
        </ActionForm>
      </Section>
      <Section title="Password">
        <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
          <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required className="input" /></div>
          <div><label className="label" htmlFor="next">New password</label><input id="next" name="next" type="password" minLength={10} autoComplete="new-password" required className="input" /></div>
          <Submit>Change password</Submit>
        </ActionForm>
      </Section>
      <Section title="Privacy (POPIA)" className="lg:col-span-2">
        <p className="mb-4 text-[14px] text-muted">You can ask for a copy of your data, request a correction, or close your account. Some records (such as invoices) are kept for the period the law requires.</p>
        <ActionForm action={privacyRequestAction} className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="kind">Request</label><select id="kind" name="kind" className="input"><option value="export">Export my data</option><option value="correction">Correct my data</option><option value="closure">Close my account</option></select></div>
          <div><label className="label" htmlFor="details">Details (optional)</label><input id="details" name="details" className="input" /></div>
          <Submit className="btn-secondary">Submit request</Submit>
        </ActionForm>
      </Section>
    </div>
  );
}
