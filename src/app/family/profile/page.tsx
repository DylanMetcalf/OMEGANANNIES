import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { AREAS } from "@/db/seed/reference";
import { addLocationAction, inviteHouseholdMemberAction, saveHouseholdAction } from "../actions";

export const metadata = { title: "Household" };
export default async function Household() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const [f] = await db.select().from(s.families).where(eq(s.families.id, familyId));
  const members = await db.select({ m: s.familyMembers, name: s.users.name, email: s.users.email }).from(s.familyMembers).innerJoin(s.users, eq(s.users.id, s.familyMembers.userId)).where(eq(s.familyMembers.familyId, familyId));
  const locs = await db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId));
  const inp = (name: keyof typeof f, label: string, type = "text") => <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} type={type} defaultValue={(f[name] as string) ?? ""} className="input" /></div>;
  return (
    <>
      <PageHeader eyebrow="Household" title={f.displayName} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Household details">
          <ActionForm action={saveHouseholdAction} className="grid gap-4 sm:grid-cols-2">
            {inp("displayName", "Household name")}{inp("countryOfResidence", "Country of residence")}{inp("preferredLanguage", "Preferred language")}
            <div><label className="label" htmlFor="preferredChannel">Preferred contact</label><select id="preferredChannel" name="preferredChannel" defaultValue={f.preferredChannel ?? "email"} className="input"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="phone">Phone</option></select></div>
            {inp("billingName", "Billing name")}{inp("billingEmail", "Billing email", "email")}
            <div className="sm:col-span-2"><label className="label" htmlFor="billingAddress">Billing address</label><textarea id="billingAddress" name="billingAddress" rows={2} defaultValue={f.billingAddress ?? ""} className="input" /></div>
            {inp("emergencyContactName", "Emergency contact")}{inp("emergencyContactPhone", "Emergency phone", "tel")}
            <div className="sm:col-span-2"><label className="label" htmlFor="bookingPreferences">Booking preferences</label><textarea id="bookingPreferences" name="bookingPreferences" rows={2} defaultValue={f.bookingPreferences ?? ""} className="input" /></div>
            <div className="sm:col-span-2"><Submit>Save details</Submit></div>
          </ActionForm>
        </Section>
        <div className="space-y-6">
          <Section title="Authorised household contacts">
            <ul className="mb-4 space-y-2 text-[14px]">{members.map((m) => <li key={m.m.userId}><p className="font-medium text-navy">{m.name}{m.m.isPrimary && <span className="ml-2 text-[12px] text-gold-600">Primary</span>}</p><p className="text-[12px] text-muted">{m.email} · {m.m.canBook ? "Can book" : "View only"}{m.m.canPay ? " · Can pay" : ""}</p></li>)}</ul>
            <ActionForm action={inviteHouseholdMemberAction} className="flex gap-2" resetOnSuccess><label htmlFor="inv" className="sr-only">Email</label><input id="inv" name="email" type="email" required placeholder="partner@example.com" className="input" /><Submit className="btn-secondary">Invite</Submit></ActionForm>
          </Section>
          <Section title="Service locations">
            <div id="locations" />
            <ul className="mb-4 space-y-2 text-[14px]">{locs.map((l) => <li key={l.id}><p className="font-medium text-navy">{l.label} · {l.area}</p><p className="text-[12px] text-muted">{l.addressLine}</p></li>)}</ul>
            <ActionForm action={addLocationAction} className="space-y-3" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3"><div><label className="label" htmlFor="label">Label</label><input id="label" name="label" placeholder="Villa" required className="input" /></div>
                <div><label className="label" htmlFor="area">Area</label><select id="area" name="area" className="input">{AREAS.map((a) => <option key={a}>{a}</option>)}<option>Other</option></select></div></div>
              <div><label className="label" htmlFor="addressLine">Address</label><input id="addressLine" name="addressLine" className="input" /><p className="mt-1 text-[12px] text-muted">Shared with your nanny only once a booking is confirmed.</p></div>
              <Submit className="btn-secondary">Add location</Submit>
            </ActionForm>
          </Section>
        </div>
      </div>
    </>
  );
}
