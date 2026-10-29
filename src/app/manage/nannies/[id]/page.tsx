import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { dates } from "@/components/booking/parts";
import { Avatar, Badge, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { services } from "@/lib/queries";
import { signDocumentUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime, minutesToHHMM } from "@/lib/time";
import { AREAS, LANGUAGES, SKILLS } from "@/db/seed/reference";
import * as A from "../../actions";

export const metadata = { title: "Nanny record" };
const KINDS = ["interview", "reference", "identity", "police_clearance", "first_aid"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export default async function NannyRecord({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string }> }) {
  const u = await requireUser({ perm: "nannies.view" });
  const { id } = await params;
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id));
  if (!n) notFound();
  const [checks, docs, changes, rules, bookings, svc, acct] = await Promise.all([
    db.select().from(s.verificationChecks).where(eq(s.verificationChecks.nannyId, id)).orderBy(desc(s.verificationChecks.createdAt)),
    db.select().from(s.documents).where(eq(s.documents.ownerNannyId, id)).orderBy(desc(s.documents.createdAt)),
    db.select().from(s.profileChangeRequests).where(eq(s.profileChangeRequests.nannyId, id)).orderBy(desc(s.profileChangeRequests.createdAt)).limit(30),
    db.select().from(s.availabilityRules).where(eq(s.availabilityRules.nannyId, id)),
    db.select().from(s.bookings).where(eq(s.bookings.nannyId, id)).orderBy(desc(s.bookings.startDate)).limit(20),
    services(), n.userId ? db.select().from(s.users).where(eq(s.users.id, n.userId)) : Promise.resolve([]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const latest = (k: string) => checks.find((c) => c.kind === k);
  const manage = can(u, "nannies.manage"), vet = can(u, "vetting.manage");
  const chips = (name: string, opts: string[][], sel: string[]) => <div className="flex flex-wrap gap-1.5">{opts.map(([v, l]) => <label key={v} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[12px]"><input type="checkbox" name={name} value={v} defaultChecked={sel.includes(v)} className="accent-navy" />{l ?? v}</label>)}</div>;
  const hidden = <input type="hidden" name="nannyId" value={n.id} />;
  const invite = (await searchParams).invite;
  return (
    <>
      <PageHeader eyebrow="Nanny record" title={n.displayName} description={<span className="flex items-center gap-2"><Badge tone={n.status === "approved" ? "ok" : n.status === "suspended" ? "bad" : "warn"}>{n.status}</Badge>{n.published ? "Published to families" : "Not published"}{acct[0] && <span className="text-[12px]">· {acct[0].email}</span>}</span>} actions={<Link href="/manage/nannies" className="btn-ghost">All nannies</Link>} />
      {invite && <div className="mb-6"><Notice tone="gold" title="Demo invitation link">{invite}</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section title="Safeguarding checks">
            <div className="grid gap-2 sm:grid-cols-5">{KINDS.map((k) => { const c = latest(k); const ok = c?.status === "passed" && (!c.expiresOn || c.expiresOn >= today); return <div key={k} className={`rounded-xl border p-3 text-[13px] ${ok ? "border-ok/30 bg-ok-50" : "border-warn/30 bg-warn-50"}`}><p className="font-medium capitalize text-navy">{k.replace("_", " ")}</p><p className={ok ? "text-ok" : "text-warn"}>{c ? (c.status === "passed" && !ok ? "expired" : c.status) : "missing"}</p>{c?.expiresOn && <p className="text-[11px] text-muted">to {fmtDate(c.expiresOn)}</p>}</div>; })}</div>
            {vet && (
              <ActionForm action={A.recordCheckAction} className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-6" resetOnSuccess>{hidden}
                <select name="kind" aria-label="Check" className="input sm:col-span-2">{KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
                <select name="status" aria-label="Result" className="input"><option value="passed">Passed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
                <input name="completedOn" type="date" aria-label="Completed on" className="input" /><input name="expiresOn" type="date" aria-label="Expires on" className="input" />
                <Submit className="btn-secondary">Record</Submit>
                <input name="notes" placeholder="Restricted notes (e.g. referee name, outcome)" aria-label="Notes" className="input sm:col-span-6" />
              </ActionForm>
            )}
            {checks.length > 0 && <details className="mt-3 text-[13px]"><summary className="cursor-pointer text-muted">History ({checks.length})</summary><ul className="mt-2 space-y-1">{checks.map((c) => <li key={c.id}>{fmtDateTime(c.createdAt)} · {c.kind} · {c.status}{vet && c.notes ? ` · ${c.notes}` : ""}</li>)}</ul></details>}
          </Section>
          <Section title="Documents">
            {docs.length ? <ul className="divide-y divide-line">{docs.map((d) => (
              <li key={d.id} className="py-3 text-[14px]">
                <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium text-navy">{d.docType.replace("_", " ")}</span> · {d.fileName}{d.expiresOn && ` · exp ${fmtDate(d.expiresOn)}`}</span><span className="flex items-center gap-2"><Badge tone={d.status === "approved" ? "ok" : d.status === "rejected" ? "bad" : "warn"}>{d.status.replace("_", " ")}</Badge>{vet && <a className="link text-[13px]" target="_blank" href={signDocumentUrl(d.id, u.id)}>Open (5 min link)</a>}</span></div>
                {vet && d.status === "pending_review" && <ActionForm action={A.reviewDocumentAction} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="documentId" value={d.id} /><input name="note" placeholder="Note to nanny" aria-label="Note" className="input !w-auto flex-1 !py-1.5" /><input name="expiresOn" type="date" aria-label="Expiry" className="input !w-auto !py-1.5" /><Submit name="status" value="approved" className="btn-primary btn-sm">Approve</Submit><Submit name="status" value="rejected" className="btn-danger btn-sm">Reject</Submit></ActionForm>}
              </li>
            ))}</ul> : <p className="text-[14px] text-muted">No documents uploaded.</p>}
          </Section>
          {manage && (
            <Section title="Profile">
              <ActionForm action={A.updateNannyAction} className="grid gap-3 sm:grid-cols-2">{hidden}
                <div><label className="label" htmlFor="dn">Display name</label><input id="dn" name="displayName" defaultValue={n.displayName} className="input" /></div>
                <div><label className="label" htmlFor="ye">Years experience</label><input id="ye" name="yearsExperience" type="number" defaultValue={n.yearsExperience} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="hl">Headline</label><input id="hl" name="headline" defaultValue={n.headline ?? ""} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="bio">Biography</label><textarea id="bio" name="bio" rows={4} defaultValue={n.bio ?? ""} className="input" /></div>
                <div className="sm:col-span-2"><p className="label">Services</p>{chips("services", svc.map((x) => [x.code, x.name]), n.services)}</div>
                <div className="sm:col-span-2"><p className="label">Languages</p>{chips("languages", LANGUAGES.map((x) => [x, x]), n.languages)}</div>
                <div className="sm:col-span-2"><p className="label">Age groups</p>{chips("ageGroups", [["newborn", "Newborn"], ["toddler", "Toddler"], ["preschool", "Pre-school"], ["school", "School"], ["teen", "Teen"]], n.ageGroups)}</div>
                <div className="sm:col-span-2"><p className="label">Areas</p>{chips("areas", AREAS.map((x) => [x, x]), n.areas)}</div>
                <div className="sm:col-span-2"><p className="label">Skills</p>{chips("skills", SKILLS.map((x) => [x, x]), n.skills)}</div>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="canDrive" defaultChecked={n.canDrive} className="accent-navy" />Licensed driver</label>
                <div><label className="label" htmlFor="ph">Approved photo URL</label><input id="ph" name="photoUrl" defaultValue={n.photoUrl ?? ""} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="se">Specialist experience</label><textarea id="se" name="specialistExperience" rows={2} defaultValue={n.specialistExperience ?? ""} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="in">Internal notes (management only)</label><textarea id="in" name="internalNotes" rows={2} defaultValue={n.internalNotes ?? ""} className="input bg-navy-50/40" /></div>
                <div className="sm:col-span-2"><Submit>Save profile</Submit></div>
              </ActionForm>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Account & status" action={<Avatar name={n.displayName} size={36} />}>
            {manage && <ActionForm action={A.nannyStatusAction} className="space-y-3">{hidden}
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="publish" defaultChecked={n.published || n.status !== "approved"} className="accent-navy" />Publish profile to families when approved</label>
              <input name="reason" placeholder="Reason (for suspension)" aria-label="Reason" className="input" />
              <div className="flex flex-wrap gap-2"><Submit name="status" value="approved" className="btn-primary btn-sm">Approve</Submit><Submit name="status" value="suspended" className="btn-danger btn-sm">Suspend</Submit><Submit name="status" value="archived" className="btn-ghost btn-sm">Archive</Submit></div>
            </ActionForm>}
            {manage && !n.userId && <ActionForm action={A.resendNannyInviteAction} className="mt-4 flex gap-2 border-t border-line pt-4">{hidden}<input name="email" type="email" required placeholder="Email" aria-label="Email" className="input" /><Submit className="btn-secondary">Invite</Submit></ActionForm>}
          </Section>
          <Section title="Profile change requests">
            {changes.filter((c) => c.status === "pending").map((c) => (
              <div key={c.id} className="mb-3 rounded-xl border border-gold/30 bg-gold-50/50 p-3 text-[13px]">
                <p className="font-medium text-navy">{c.field}</p><p className="text-muted">From: {JSON.stringify(c.oldValue)}</p><p>To: {JSON.stringify(c.newValue)}</p>
                {manage && <ActionForm action={A.decideChangeAction} className="mt-2 flex gap-2"><input type="hidden" name="changeId" value={c.id} /><Submit name="decision" value="approve" className="btn-primary btn-sm">Approve</Submit><Submit name="decision" value="reject" className="btn-secondary btn-sm">Decline</Submit></ActionForm>}
              </div>
            ))}
            <ul className="space-y-1 text-[12px] text-muted">{changes.filter((c) => c.status !== "pending").slice(0, 10).map((c) => <li key={c.id}>{fmtDateTime(c.createdAt)} · {c.field} · {c.status}</li>)}</ul>
            {!changes.length && <p className="text-[14px] text-muted">No changes.</p>}
          </Section>
          <Section title="Availability"><ul className="grid grid-cols-2 gap-1 text-[13px]">{[1, 2, 3, 4, 5, 6, 0].map((w) => { const r = rules.find((x) => x.weekday === w); return <li key={w}>{DAYS[w]}: {r ? `${minutesToHHMM(r.startMinute)}–${minutesToHHMM(r.endMinute)}` : <span className="text-muted">off</span>}</li>; })}</ul></Section>
          <Section title="Booking history">{bookings.length ? <ul className="space-y-2 text-[14px]">{bookings.map((b) => <li key={b.id} className="flex justify-between gap-2"><Link className="link" href={`/manage/bookings/${b.id}`}>{dates(b)}</Link><StatusBadge status={b.status} /></li>)}</ul> : <p className="text-[14px] text-muted">No bookings.</p>}</Section>
        </div>
      </div>
    </>
  );
}
