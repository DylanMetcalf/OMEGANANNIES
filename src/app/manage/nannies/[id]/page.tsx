import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { dates } from "@/components/booking/parts";
import { Avatar, Badge, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { completeness, lifecycle, onboardingContext, REQUIRED_DOCS, SAFEGUARDING } from "@/lib/onboarding";
import { can } from "@/lib/permissions";
import { services } from "@/lib/queries";
import { signDocumentUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime, minutesToHHMM } from "@/lib/time";
import { AREAS, LANGUAGES, SKILLS } from "@/db/seed/reference";
import * as A from "../../actions";

export const metadata = { title: "Nanny record" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FIELD_LABEL: Record<string, string> = { displayName: "Name", headline: "Headline", bio: "Biography", yearsExperience: "Experience", languages: "Languages", canDrive: "Driving", skills: "Skills", ageGroups: "Age groups", photo: "Photo", services: "Services", areas: "Areas", specialistExperience: "Specialist experience" };
type Prov = Record<string, { source: string; verified?: boolean; at?: string; verifiedAt?: string }>;

export default async function NannyRecord({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser({ perm: "nannies.view" });
  const { id } = await params;
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, id));
  if (!n) notFound();
  const [ctx, docs, changes, rules, bookings, svc, acct] = await Promise.all([
    onboardingContext([id]),
    db.select().from(s.documents).where(eq(s.documents.ownerNannyId, id)).orderBy(desc(s.documents.createdAt)),
    db.select().from(s.profileChangeRequests).where(eq(s.profileChangeRequests.nannyId, id)).orderBy(desc(s.profileChangeRequests.createdAt)).limit(30),
    db.select().from(s.availabilityRules).where(eq(s.availabilityRules.nannyId, id)),
    db.select().from(s.bookings).where(eq(s.bookings.nannyId, id)).orderBy(desc(s.bookings.startDate)).limit(20),
    services(), n.userId ? db.select().from(s.users).where(eq(s.users.id, n.userId)) : Promise.resolve([]),
  ]);
  const stage = lifecycle(n, { invitation: ctx.invitations[0], docs: ctx.docs, checks: ctx.checks });
  const comp = completeness(n, docs);
  const today = new Date().toISOString().slice(0, 10);
  const latest = (k: string) => ctx.checks.find((c) => c.kind === k);
  const manage = can(u, "nannies.manage"), vet = can(u, "vetting.manage");
  const prov = n.provenance as Prov;
  const openInvite = ctx.invitations.find((i) => i.status === "sent" && i.expiresAt > new Date());
  const chips = (name: string, opts: string[][], sel: string[]) => <div className="flex flex-wrap gap-1.5">{opts.map(([v, l]) => <label key={v} className="chip"><input type="checkbox" name={name} value={v} defaultChecked={sel.includes(v)} className="sr-only" />{l ?? v}</label>)}</div>;
  const hidden = <input type="hidden" name="nannyId" value={n.id} />;
  const provBadge = (f: string) => { const p = prov[f]; if (!p) return <Badge>Not set</Badge>; return p.verified ? <Badge tone="ok">Verified by Omega</Badge> : <Badge tone={p.source === "website" ? "gold" : "info"}>{p.source === "website" ? "From website · unverified" : p.source === "nanny" ? "From nanny · unverified" : p.source === "csv" ? "From CSV · unverified" : "Entered by Omega"}</Badge>; };
  return (
    <>
      <PageHeader eyebrow="Nanny record" title={n.displayName} description={<span className="flex flex-wrap items-center gap-2"><Badge tone={stage.tone}>{stage.label}</Badge>{n.published && <Badge tone="ok">Visible to families</Badge>}{acct[0] && <span className="text-[13px]">Login: {acct[0].email}</span>}</span>} actions={<><Link href={`/manage/tasks?nannyId=${n.id}`} className="btn-secondary">Add task</Link><Link href="/manage/nannies" className="btn-ghost">All nannies</Link></>} />
      <div className="mb-6"><Notice tone={stage.tone === "bad" ? "bad" : stage.tone === "ok" ? "ok" : "info"} title="Next step">{stage.next}</Notice></div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="space-y-6">
          <Section title="Profile details & provenance" description="Where each detail came from, and whether Omega has verified it.">
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead>
              <tbody>{Object.keys(FIELD_LABEL).map((f) => {
                const v = f === "photo" ? (n.photoKey ? "Photo on file" : null) : (n as Record<string, unknown>)[f];
                const shown = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : f === "yearsExperience" ? `${v} years` : (v as string | null);
                return <tr key={f}><td className="font-medium">{FIELD_LABEL[f]}</td><td className="max-w-[360px] text-[13px] text-muted">{shown ? String(shown).slice(0, 160) : "—"}</td><td>{provBadge(f)}</td></tr>;
              })}</tbody>
            </table></div>
            {vet && (
              <ActionForm action={A.verifyFieldsAction} className="mt-4 space-y-2 border-t border-line pt-4">{hidden}
                <p className="text-[13px] text-muted">Tick the details you have personally confirmed (e.g. at interview), then record them as verified.</p>
                <div className="flex flex-wrap gap-1.5">{Object.keys(FIELD_LABEL).filter((f) => !prov[f]?.verified).map((f) => <label key={f} className="chip"><input type="checkbox" name="fields" value={f} className="sr-only" />{FIELD_LABEL[f]}</label>)}</div>
                <Submit className="btn-secondary btn-sm">Mark selected as verified</Submit>
              </ActionForm>
            )}
            {n.importSource && <p className="mt-3 text-[12px] text-muted">Imported from {n.importSource === "website" ? <a className="link" href={n.sourceUrl ?? "#"}>{n.sourceUrl}</a> : "CSV"}{n.importedAt && ` on ${fmtDateTime(n.importedAt)}`}.</p>}
          </Section>
          <Section title="Safeguarding checks" description="Approval needs all five current. Uploading a document never counts as a check.">
            <div className="grid gap-2 sm:grid-cols-5">{SAFEGUARDING.map((k) => { const c = latest(k); const ok = c?.status === "passed" && (!c.expiresOn || c.expiresOn >= today); return <div key={k} className={`rounded-[10px] border p-3 text-[13px] ${ok ? "border-ok/30 bg-ok-50" : "border-line bg-cream"}`}><p className="font-semibold capitalize text-ink">{k.replace("_", " ")}</p><p className={ok ? "text-ok" : "text-warn"}>{c ? (c.status === "passed" && !ok ? "Expired" : c.status) : "Not recorded"}</p>{c?.expiresOn && <p className="text-[12px] text-muted">to {fmtDate(c.expiresOn)}</p>}</div>; })}</div>
            {vet && (
              <ActionForm action={A.recordCheckAction} className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-6" resetOnSuccess>{hidden}
                <select name="kind" aria-label="Check" className="input sm:col-span-2">{SAFEGUARDING.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
                <select name="status" aria-label="Result" className="input"><option value="passed">Passed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
                <input name="completedOn" type="date" aria-label="Completed on" className="input" /><input name="expiresOn" type="date" aria-label="Expires on" className="input" />
                <Submit className="btn-secondary">Record</Submit>
                <input name="notes" placeholder="Restricted notes (e.g. referee, outcome)" aria-label="Notes" className="input sm:col-span-6" />
              </ActionForm>
            )}
          </Section>
          <Section title="Documents" description={`Required: ${REQUIRED_DOCS.join(", ").replace(/_/g, " ")}.`}>
            {docs.length ? <ul className="divide-y divide-line">{docs.map((d) => (
              <li key={d.id} className="py-3 text-[14px]">
                <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-semibold capitalize text-ink">{d.docType.replace(/_/g, " ")}</span> <span className="text-muted">· {d.fileName}{d.expiresOn && ` · expires ${fmtDate(d.expiresOn)}`}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={d.status === "approved" ? "ok" : d.status === "rejected" ? "bad" : "warn"}>{d.status.replace("_", " ")}</Badge><Badge tone={d.scanStatus === "clean" ? "ok" : d.scanStatus === "infected" ? "bad" : "neutral"}>{d.scanStatus === "not_scanned" ? "Not virus-scanned" : `Scan: ${d.scanStatus}`}</Badge>{vet && <a className="link text-[13px]" target="_blank" rel="noopener noreferrer" href={signDocumentUrl(d.id, u.id)}>Open</a>}</span></div>
                {vet && d.status === "pending_review" && <ActionForm action={A.reviewDocumentAction} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="documentId" value={d.id} /><input name="note" placeholder="Note to nanny" aria-label="Note" className="input !w-auto flex-1" /><input name="expiresOn" type="date" aria-label="Expiry" className="input !w-auto" /><Submit name="status" value="approved" className="btn-primary btn-sm">Approve</Submit><Submit name="status" value="rejected" className="btn-danger btn-sm">Reject</Submit></ActionForm>}
              </li>
            ))}</ul> : <p className="text-[14px] text-muted">No documents yet. {n.userId ? "The nanny uploads these from their portal." : "Documents are uploaded once the nanny claims the account."}</p>}
          </Section>
          {manage && (
            <Section title="Edit profile">
              <ActionForm action={A.updateNannyAction} className="grid gap-3 sm:grid-cols-2">{hidden}
                <div><label className="label" htmlFor="dn">Display name</label><input id="dn" name="displayName" defaultValue={n.displayName} className="input" /></div>
                <div><label className="label" htmlFor="ye">Years experience</label><input id="ye" name="yearsExperience" type="number" min={0} max={60} defaultValue={n.yearsExperience} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="hl">Headline</label><input id="hl" name="headline" defaultValue={n.headline ?? ""} maxLength={140} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="bio">Biography</label><textarea id="bio" name="bio" rows={4} defaultValue={n.bio ?? ""} className="input" /></div>
                <fieldset className="sm:col-span-2"><legend className="label">Services</legend>{chips("services", svc.map((x) => [x.code, x.name]), n.services)}</fieldset>
                <fieldset className="sm:col-span-2"><legend className="label">Languages</legend>{chips("languages", LANGUAGES.map((x) => [x, x]), n.languages)}</fieldset>
                <fieldset className="sm:col-span-2"><legend className="label">Age groups</legend>{chips("ageGroups", [["newborn", "Newborn"], ["toddler", "Toddler"], ["preschool", "Pre-school"], ["school", "School age"], ["teen", "Teen"]], n.ageGroups)}</fieldset>
                <fieldset className="sm:col-span-2"><legend className="label">Areas</legend>{chips("areas", AREAS.map((x) => [x, x]), n.areas)}</fieldset>
                <fieldset className="sm:col-span-2"><legend className="label">Skills</legend>{chips("skills", SKILLS.map((x) => [x, x]), n.skills)}</fieldset>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="canDrive" defaultChecked={n.canDrive} className="h-4 w-4 accent-navy" />Licensed driver</label>
                <div className="sm:col-span-2"><label className="label" htmlFor="se">Specialist experience</label><textarea id="se" name="specialistExperience" rows={2} defaultValue={n.specialistExperience ?? ""} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="in">Internal notes (management only)</label><textarea id="in" name="internalNotes" rows={2} defaultValue={n.internalNotes ?? ""} className="input bg-navy-50/40" /></div>
                <div className="sm:col-span-2"><Submit>Save profile</Submit><p className="mt-1 text-[12px] text-muted">Edited fields are recorded as “Entered by Omega” until verified.</p></div>
              </ActionForm>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Status & publication">
            <div className="flex items-center gap-3"><Avatar name={n.displayName} src={n.photoKey ? `/api/photos/${n.id}` : null} size={56} /><div><p className="text-[14px] font-semibold">{comp.pct}% complete</p><div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-sand"><div className="h-full bg-gold" style={{ width: `${comp.pct}%` }} /></div></div></div>
            {comp.missing.length > 0 && <p className="mt-3 text-[13px] text-muted">Missing: {comp.missing.join(", ")}</p>}
            {manage && (
              <ActionForm action={A.nannyStatusAction} className="mt-4 space-y-3 border-t border-line pt-4" confirm="Apply this status change?">{hidden}
                <input name="reason" placeholder="Reason (recorded in the audit log)" aria-label="Reason" className="input" />
                <div className="flex flex-wrap gap-2">
                  {n.status !== "approved" && <Submit name="status" value="approve" className="btn-primary btn-sm">Approve</Submit>}
                  {n.status === "approved" && !n.published && <Submit name="status" value="publish" className="btn-primary btn-sm">Publish to families</Submit>}
                  {n.published && <Submit name="status" value="unpublish" className="btn-secondary btn-sm">Unpublish</Submit>}
                  {["approved", "pending_approval", "suspended", "archived"].includes(n.status) && <Submit name="status" value="reopen" className="btn-secondary btn-sm">Return to onboarding</Submit>}
                  {n.status !== "suspended" && <Submit name="status" value="suspend" className="btn-danger btn-sm">Suspend</Submit>}
                  {n.status !== "archived" && <Submit name="status" value="archive" className="btn-ghost btn-sm">Archive</Submit>}
                </div>
              </ActionForm>
            )}
          </Section>
          {manage && !n.userId && (
            <Section title="Account invitation" description="The nanny claims this profile with a single-use link sent to this address.">
              <ActionForm action={A.contactAction} className="space-y-2">{hidden}
                <div><label className="label" htmlFor="ce">Email address</label><input id="ce" name="email" type="email" defaultValue={n.contactEmail ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="cp">Phone</label><input id="cp" name="phone" type="tel" defaultValue={n.contactPhone ?? ""} className="input" /></div>
                <Submit className="btn-secondary btn-sm">Save contact</Submit>
              </ActionForm>
              <div className="mt-4 border-t border-line pt-4">
                {openInvite ? <p className="mb-2 text-[13px]">Open invitation to <b>{openInvite.email}</b>, expires {fmtDateTime(openInvite.expiresAt)}.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={A.inviteNannyAction}>{hidden}<Submit className="btn-primary btn-sm" pendingText="Sending…">{openInvite ? "Resend (replaces link)" : "Send invitation"}</Submit></ActionForm>
                  {openInvite && <ActionForm action={A.revokeInviteAction} confirm="Revoke this invitation? The link will stop working."><input type="hidden" name="invitationId" value={openInvite.id} /><Submit className="btn-danger btn-sm">Revoke</Submit></ActionForm>}
                </div>
              </div>
              {ctx.invitations.length > 0 && <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[12px] text-muted">{ctx.invitations.slice(0, 6).map((i) => <li key={i.id}>{fmtDateTime(i.createdAt)} · {i.email} · <span className="capitalize">{i.status === "sent" && i.expiresAt < new Date() ? "expired" : i.status}</span>{i.failedAttempts ? ` · ${i.failedAttempts} failed attempts` : ""}</li>)}</ul>}
            </Section>
          )}
          {manage && (
            <Section title="Profile photo" description="JPG, PNG or WebP up to 5 MB. Shown only on approved, published profiles.">
              <ActionForm action={A.adminPhotoAction} className="flex flex-wrap gap-2" resetOnSuccess>{hidden}<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required aria-label="Photo" className="input flex-1" /><Submit className="btn-secondary">Upload</Submit></ActionForm>
            </Section>
          )}
          <Section title="Change requests">
            {changes.filter((c) => c.status === "pending").map((c) => (
              <div key={c.id} className="mb-3 rounded-[10px] border border-gold/30 bg-gold-50/60 p-3 text-[13px]">
                <p className="font-semibold">{FIELD_LABEL[c.field] ?? (c.field === "photoKey" ? "Photo" : c.field)}</p>
                {c.field === "photoKey" ? <p className="text-muted">New photo uploaded by the nanny.</p> : <><p className="text-muted">From: {JSON.stringify(c.oldValue)}</p><p>To: {JSON.stringify(c.newValue)}</p></>}
                {manage && <ActionForm action={A.decideChangeAction} className="mt-2 flex gap-2"><input type="hidden" name="changeId" value={c.id} /><Submit name="decision" value="approve" className="btn-primary btn-sm">Approve</Submit><Submit name="decision" value="reject" className="btn-secondary btn-sm">Decline</Submit></ActionForm>}
              </div>
            ))}
            <ul className="space-y-1 text-[12px] text-muted">{changes.filter((c) => c.status !== "pending").slice(0, 10).map((c) => <li key={c.id}>{fmtDateTime(c.createdAt)} · {FIELD_LABEL[c.field] ?? c.field} · {c.status}</li>)}</ul>
            {!changes.length && <p className="text-[14px] text-muted">No changes.</p>}
          </Section>
          <Section title="Availability"><ul className="grid grid-cols-2 gap-1 text-[13px]">{[1, 2, 3, 4, 5, 6, 0].map((w) => { const r = rules.find((x) => x.weekday === w); return <li key={w}>{DAYS[w]}: {r ? `${minutesToHHMM(r.startMinute)}–${minutesToHHMM(r.endMinute)}` : <span className="text-subtle">off</span>}</li>; })}</ul></Section>
          <Section title="Booking history">{bookings.length ? <ul className="space-y-2 text-[14px]">{bookings.map((b) => <li key={b.id} className="flex justify-between gap-2"><Link className="link" href={`/manage/bookings/${b.id}`}>{dates(b)}</Link><StatusBadge status={b.status} /></li>)}</ul> : <p className="text-[14px] text-muted">No bookings.</p>}</Section>
        </div>
      </div>
    </>
  );
}
