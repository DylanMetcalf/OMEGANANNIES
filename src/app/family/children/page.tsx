import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { ageLabel } from "@/lib/time";
import { deleteChildAction, saveChildAction } from "../actions";

export const metadata = { title: "Children" };
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
export default async function Children() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const kids = await db.select().from(s.children).where(eq(s.children.familyId, familyId)).orderBy(s.children.dateOfBirth);
  return (
    <>
      <PageHeader eyebrow="Your family" title="Children" description="We only ask for what helps your nanny care for your children safely. You can update or remove details at any time." />
      <div className="space-y-6">
        {kids.length === 0 && <Empty title="Add your children">This lets us match the right nanny for their ages and needs.</Empty>}
        {kids.map((c) => (
          <Section key={c.id} title={`${c.preferredName} · ${ageLabel(c.dateOfBirth)}`} action={<ActionForm action={deleteChildAction} confirm={`Remove ${c.preferredName}?`}><input type="hidden" name="id" value={c.id} /><Submit className="btn-ghost btn-sm" pendingText="Removing…">Remove</Submit></ActionForm>}>
            <ChildForm c={c} />
          </Section>
        ))}
        <Section title="Add a child"><ChildForm /></Section>
      </div>
    </>
  );
}
