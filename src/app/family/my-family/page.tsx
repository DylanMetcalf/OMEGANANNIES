import Link from "next/link";
import { eq } from "drizzle-orm";
import { Baby, House, MapPin, Users } from "lucide-react";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { ageLabel } from "@/lib/time";
import { AREAS } from "@/db/seed/reference";
import { addLocationAction, deleteChildAction, inviteHouseholdMemberAction, saveChildAction, saveHouseholdAction } from "../actions";

export const metadata = { title: "My Family" };
type Child = typeof s.children.$inferSelect;
const FIELDS: [keyof Child, string, string][] = [
  ["allergies", "Allergies", "e.g. Peanuts — carries EpiPen"], ["dietaryNeeds", "Dietary needs", "e.g. Vegetarian"], ["routines", "Routines", "Naps, bedtime, screen time…"],
  ["interests", "Interests", "What do they love?"], ["careRequirements", "Care requirements", "Anything your nanny must know"], ["additionalNeeds", "Additional support needs", "Only what helps us care well"],
  ["emergencyInstructions", "Emergency instructions", "Medication, doctor, what to do"],
];
function ChildForm({ c }: { c?: Child }) {
  const id = c?.id ?? "new";
  return (
    <ActionForm action={saveChildAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess={!c}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div><label className="label" htmlFor={`n-${id}`}>Preferred name</label><input id={`n-${id}`} name="preferredName" defaultValue={c?.preferredName} required maxLength={60} className="input" /></div>
      <div><label className="label" htmlFor={`d-${id}`}>Date of birth</label><input id={`d-${id}`} name="dateOfBirth" type="date" defaultValue={c?.dateOfBirth ?? ""} className="input" /></div>
      {FIELDS.map(([k, l, p]) => <div key={k} className={k === "emergencyInstructions" ? "sm:col-span-2" : ""}><label className="label" htmlFor={`${k}-${id}`}>{l}</label><textarea id={`${k}-${id}`} name={k} rows={2} placeholder={p} defaultValue={(c?.[k] as string) ?? ""} className="input" /></div>)}
      <label className="flex gap-2.5 text-[13px] sm:col-span-2"><input type="checkbox" name="consent" required defaultChecked={!!c} className="mt-0.5 accent-navy" /><span>I&rsquo;m this child&rsquo;s parent or guardian and consent to Omega Nannies using this information to care for them. Medical details are shown to your nanny only for confirmed bookings.</span></label>
      <div className="sm:col-span-2"><Submit>{c ? "Save changes" : "Add child"}</Submit></div>
    </ActionForm>
  );
}

const TABS = [["household", "Household", House], ["children", "Children", Baby], ["addresses", "Addresses", MapPin], ["contacts", "Household members", Users]] as const;
type Tab = (typeof TABS)[number][0];

/**
 * One place for everything about the family. Households, children, addresses and members remain separate records
 * (with their own permissions); they are simply presented together here.
 */
export default async function MyFamily({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser({ role: "family" });
  const want = (await searchParams).tab;
  const tab: Tab = TABS.find(([k]) => k === want)?.[0] ?? "household";
  const [familyId] = await familyIdsOf(u.id);
  const [[f], kids, locs, members] = await Promise.all([
    db.select().from(s.families).where(eq(s.families.id, familyId)),
    db.select().from(s.children).where(eq(s.children.familyId, familyId)).orderBy(s.children.dateOfBirth),
    db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId)),
    db.select({ m: s.familyMembers, name: s.users.name, email: s.users.email }).from(s.familyMembers).innerJoin(s.users, eq(s.users.id, s.familyMembers.userId)).where(eq(s.familyMembers.familyId, familyId)),
  ]);
  const inp = (name: keyof typeof f, label: string, type = "text") => <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} type={type} defaultValue={(f[name] as string) ?? ""} className="input" /></div>;
  const counts: Record<Tab, number | null> = { household: null, children: kids.length, addresses: locs.length, contacts: members.length };
  const missing = [!kids.length && "children", !locs.length && "an address", !f.emergencyContactPhone && "an emergency contact"].filter(Boolean);
  return (
    <>
      <PageHeader eyebrow="My Family" title={f.displayName} description="Your household, children and addresses in one place. We only ask for what helps your nanny care for your family safely." />
      {missing.length > 0 && <p className="mb-5 rounded-[12px] bg-gold-50 px-4 py-3 text-[14px] text-gold-600">To book smoothly, add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.</p>}
      <nav aria-label="My Family sections" className="mb-6 flex gap-1 overflow-x-auto rounded-[12px] bg-sand p-1">
        {TABS.map(([k, l, I]) => <Link key={k} href={`?tab=${k}`} scroll={false} aria-current={tab === k ? "page" : undefined} className={`flex items-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[14px] font-medium transition-colors ${tab === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}><I aria-hidden className="h-4 w-4" />{l}{counts[k] !== null && <span className="text-muted tabular-nums">{counts[k]}</span>}</Link>)}
      </nav>
      {tab === "household" && (
        <Section title="Household details" description="Billing details and the emergency contact Omega should call.">
          <ActionForm action={saveHouseholdAction} className="grid gap-4 sm:grid-cols-2">
            {inp("displayName", "Household name")}{inp("countryOfResidence", "Country of residence")}{inp("preferredLanguage", "Preferred language")}
            <div><label className="label" htmlFor="preferredChannel">Preferred contact</label><select id="preferredChannel" name="preferredChannel" defaultValue={f.preferredChannel ?? "email"} className="input"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="phone">Phone</option></select></div>
            {inp("billingName", "Billing name")}{inp("billingEmail", "Billing email", "email")}
            <div className="sm:col-span-2"><label className="label" htmlFor="billingAddress">Billing address</label><textarea id="billingAddress" name="billingAddress" rows={2} defaultValue={f.billingAddress ?? ""} className="input" /></div>
            <p className="eyebrow pt-2 sm:col-span-2">Emergency contact</p>
            {inp("emergencyContactName", "Name")}{inp("emergencyContactPhone", "Phone", "tel")}
            <div className="sm:col-span-2"><label className="label" htmlFor="bookingPreferences">Care requirements for every booking</label><textarea id="bookingPreferences" name="bookingPreferences" rows={2} defaultValue={f.bookingPreferences ?? ""} placeholder="House rules, pets, routines that apply to all children…" className="input" /></div>
            <div className="sm:col-span-2"><Submit>Save details</Submit></div>
          </ActionForm>
        </Section>
      )}
      {tab === "children" && (
        <div className="space-y-6">
          {kids.length === 0 && <Empty title="Add your children">This lets us match the right nanny for their ages and needs.</Empty>}
          {kids.map((c) => (
            <Section key={c.id} title={`${c.preferredName} · ${ageLabel(c.dateOfBirth)}`} action={<ActionForm action={deleteChildAction} confirm={`Remove ${c.preferredName}?`}><input type="hidden" name="id" value={c.id} /><Submit className="btn-ghost btn-sm" pendingText="Removing…">Remove</Submit></ActionForm>}>
              <ChildForm c={c} />
            </Section>
          ))}
          <Section title="Add a child"><ChildForm /></Section>
        </div>
      )}
      {tab === "addresses" && (
        <Section title="Addresses for care" description="Shared with your nanny only once a booking is confirmed (or from the first care day, if Omega uses that rule).">
          {locs.length ? <ul className="mb-5 divide-y divide-line text-[14px]">{locs.map((l) => <li key={l.id} className="py-2.5"><p className="font-medium text-ink">{l.label} · {l.area}</p><p className="text-[13px] text-muted">{l.addressLine}</p></li>)}</ul> : <p className="mb-4 text-[14px] text-muted">No addresses yet.</p>}
          <ActionForm action={addLocationAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <div><label className="label" htmlFor="label">Label</label><input id="label" name="label" placeholder="Home, holiday villa…" required className="input" /></div>
            <div><label className="label" htmlFor="area">Area</label><select id="area" name="area" className="input">{AREAS.map((a) => <option key={a}>{a}</option>)}<option>Other</option></select></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="addressLine">Address</label><input id="addressLine" name="addressLine" autoComplete="street-address" className="input" /></div>
            <div className="sm:col-span-2"><Submit className="btn-secondary">Add address</Submit></div>
          </ActionForm>
        </Section>
      )}
      {tab === "contacts" && (
        <Section title="Household members" description="Partners or relatives who can see bookings. Booking and paying are separate permissions.">
          <ul className="mb-5 divide-y divide-line text-[14px]">{members.map((m) => <li key={m.m.userId} className="py-2.5"><p className="font-medium text-ink">{m.name}{m.m.isPrimary && <span className="ml-2 text-[12px] text-gold-600">Primary</span>}</p><p className="text-[13px] text-muted">{m.email} · {m.m.canBook ? "Can book" : "View only"}{m.m.canPay ? " · Can pay" : ""}</p></li>)}</ul>
          <ActionForm action={inviteHouseholdMemberAction} className="flex max-w-md gap-2" resetOnSuccess><label htmlFor="inv" className="sr-only">Email</label><input id="inv" name="email" type="email" required placeholder="partner@example.com" className="input" /><Submit className="btn-secondary">Invite</Submit></ActionForm>
        </Section>
      )}
    </>
  );
}
