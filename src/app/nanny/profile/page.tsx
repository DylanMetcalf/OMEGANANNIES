import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Avatar, Badge, Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { services } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { AREAS, LANGUAGES, SKILLS } from "@/db/seed/reference";
import { respondToReviewAction, saveProfileAction } from "../actions";

export const metadata = { title: "My profile" };
const AGES = [["newborn", "Newborns"], ["toddler", "Toddlers"], ["preschool", "Pre-school"], ["school", "School age"], ["teen", "Teens"]];
export default async function NannyProfile() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked" />;
  const svc = await services();
  const changes = await db.select().from(s.profileChangeRequests).where(eq(s.profileChangeRequests.nannyId, n.id)).orderBy(desc(s.profileChangeRequests.createdAt)).limit(20);
  const reviews = await db.select().from(s.reviews).where(eq(s.reviews.nannyId, n.id)).orderBy(desc(s.reviews.createdAt));
  const pending = new Set(changes.filter((c) => c.status === "pending").map((c) => c.field));
  const chips = (name: string, opts: string[][], selected: string[]) => <div className="flex flex-wrap gap-2">{opts.map(([v, l]) => <label key={v} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px]"><input type="checkbox" name={name} value={v} defaultChecked={selected.includes(v)} className="accent-navy" />{l ?? v}</label>)}</div>;
  const tag = (f: string) => pending.has(f) ? <Badge tone="warn">Change pending review</Badge> : <Badge tone="info">Reviewed by Omega</Badge>;
  return (
    <>
      <PageHeader eyebrow="Profile" title="My profile" description="Families see your approved profile. Some fields update instantly; those linked to vetting are reviewed by Omega first." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ActionForm action={saveProfileAction} className="space-y-6">
          <Section title="About you · updates instantly">
            <div className="space-y-4">
              <div><label className="label" htmlFor="headline">Headline</label><input id="headline" name="headline" maxLength={140} defaultValue={n.headline ?? ""} className="input" /></div>
              <div><label className="label" htmlFor="bio">Biography</label><textarea id="bio" name="bio" rows={6} maxLength={3000} defaultValue={n.bio ?? ""} className="input" /></div>
              <div><p className="label">Languages</p>{chips("languages", LANGUAGES.map((l) => [l, l]), n.languages)}</div>
              <div><p className="label">Skills</p>{chips("skills", SKILLS.map((l) => [l, l]), n.skills)}</div>
            </div>
          </Section>
          <Section title="Experience & services · reviewed by Omega">
            <div className="space-y-4">
              <div><div className="mb-1.5 flex justify-between"><p className="label !mb-0">Services</p>{tag("services")}</div>{chips("services", svc.map((x) => [x.code, x.name]), n.services)}</div>
              <div><div className="mb-1.5 flex justify-between"><p className="label !mb-0">Age groups</p>{tag("ageGroups")}</div>{chips("ageGroups", AGES, n.ageGroups)}</div>
              <div><div className="mb-1.5 flex justify-between"><p className="label !mb-0">Areas</p>{tag("areas")}</div>{chips("areas", AREAS.map((a) => [a, a]), n.areas)}</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label" htmlFor="yearsExperience">Years of experience</label><input id="yearsExperience" name="yearsExperience" type="number" min={0} max={60} defaultValue={n.yearsExperience} className="input" /></div>
                <div><label className="label" htmlFor="canDrive">Driving</label><select id="canDrive" name="canDrive" defaultValue={n.canDrive ? "yes" : "no"} className="input"><option value="yes">Licensed driver</option><option value="no">Don&rsquo;t drive</option></select></div>
              </div>
              <div><label className="label" htmlFor="specialistExperience">Specialist experience</label><textarea id="specialistExperience" name="specialistExperience" rows={2} defaultValue={n.specialistExperience ?? ""} className="input" /></div>
            </div>
          </Section>
          <Submit>Save profile</Submit>
        </ActionForm>
        <div className="space-y-6">
          <Section title="How families see you"><div className="flex items-center gap-3"><Avatar name={n.displayName} src={n.photoUrl} size={56} /><div><p className="font-display text-[22px] text-navy">{n.displayName}</p><p className="text-[13px] text-muted">{n.published ? "Published" : "Not yet published"} · {n.status}</p></div></div><p className="mt-3 text-[12px] text-muted">Photos are taken and approved by Omega — message the team to update yours.</p></Section>
          <Section title="Change history">{changes.length ? <ul className="space-y-2 text-[13px]">{changes.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.field}</span><span className="text-muted">{c.status} · {fmtDateTime(c.createdAt)}</span></li>)}</ul> : <p className="text-[14px] text-muted">No changes yet.</p>}</Section>
          <Section title="Reviews">{reviews.length ? <ul className="space-y-4">{reviews.map((r) => <li key={r.id} className="text-[14px]"><p className="text-gold">{"★".repeat(r.rating)} <span className="text-[12px] text-muted">{r.status}</span></p><p>{r.body}</p>{r.nannyResponse ? <p className="mt-1 border-l-2 border-gold pl-2 text-muted">You: {r.nannyResponse}</p> : r.status === "published" && <ActionForm action={respondToReviewAction} className="mt-2 flex gap-2"><input type="hidden" name="reviewId" value={r.id} /><input name="response" aria-label="Response" placeholder="Thank the family…" className="input !py-1.5" /><Submit className="btn-secondary btn-sm">Reply</Submit></ActionForm>}</li>)}</ul> : <p className="text-[14px] text-muted">No reviews yet.</p>}</Section>
        </div>
      </div>
    </>
  );
}
