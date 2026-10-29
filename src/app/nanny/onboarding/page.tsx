import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Avatar, Badge, Empty, Notice, PageHeader, Section, Steps } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { completeness, REQUIRED_DOCS } from "@/lib/onboarding";
import { confirmDetailsAction, photoChangeAction, submitProfileAction, uploadDocumentAction } from "../actions";

export const metadata = { title: "Onboarding" };
const DOC: Record<string, string> = { id_document: "Identity document", police_clearance: "Police clearance certificate", first_aid: "First Aid certificate" };
const LABEL: Record<string, string> = { displayName: "Name", headline: "Headline", bio: "Biography", yearsExperience: "Experience", languages: "Languages", canDrive: "Driving", skills: "Skills", ageGroups: "Age groups", photo: "Photo" };

export default async function Onboarding() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked">Please contact Omega Nannies.</Empty>;
  const docs = await db.select().from(s.documents).where(eq(s.documents.ownerNannyId, n.id));
  const comp = completeness(n, docs);
  const prov = n.provenance as Record<string, { source: string; confirmedByNanny?: boolean; verified?: boolean }>;
  const imported = Object.entries(prov).filter(([, p]) => ["website", "csv", "admin"].includes(p.source));
  const confirmed = imported.length > 0 && imported.every(([, p]) => p.confirmedByNanny || p.verified);
  const docsDone = REQUIRED_DOCS.every((d) => docs.some((x) => x.docType === d && x.status !== "rejected"));
  const step = n.status === "pending_approval" || n.status === "approved" ? 4 : !confirmed && imported.length ? 1 : !docsDone ? 2 : 3;
  return (
    <>
      <PageHeader eyebrow="Getting started" title="Your Omega profile" description="Omega Nannies prepared your profile. Check it, add your documents and send it back for approval." />
      <div className="card mb-6 p-5"><Steps steps={["Claim account", "Review details", "Photo & documents", "Submit for approval"]} current={step} /></div>
      {n.status === "pending_approval" && <div className="mb-6"><Notice tone="gold" title="With Omega for review">We’ll review your documents and record your checks. You’ll get a notification when you’re approved.</Notice></div>}
      {n.status === "approved" && <div className="mb-6"><Notice tone="ok" title="You’re approved">{n.published ? "Your profile is visible to families." : "Omega will publish your profile shortly."}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section title="1. Review the details Omega prepared" description="Anything incorrect? Update it on your profile page — some changes go to Omega for approval.">
            {imported.length ? (
              <ul className="divide-y divide-line">{imported.map(([k, p]) => <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-[14px]"><span>{LABEL[k] ?? k}</span><Badge tone={p.verified ? "ok" : p.confirmedByNanny ? "info" : "gold"}>{p.verified ? "Verified by Omega" : p.confirmedByNanny ? "Confirmed by you" : p.source === "website" ? "From the Omega website" : "Prepared by Omega"}</Badge></li>)}</ul>
            ) : <p className="text-[14px] text-muted">Your profile was started from scratch — fill it in on your profile page.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/nanny/profile" className="btn-secondary">Edit my profile</Link>
              {imported.length > 0 && !confirmed && <ActionForm action={confirmDetailsAction}><Submit className="btn-primary">These details are correct</Submit></ActionForm>}
            </div>
          </Section>
          <Section title="2. Required documents" description="Stored privately. Only you and authorised Omega staff can open them.">
            <ul className="mb-4 space-y-2">{REQUIRED_DOCS.map((d) => { const doc = docs.find((x) => x.docType === d && x.status !== "rejected"); return <li key={d} className="flex items-center justify-between gap-3 text-[14px]"><span>{DOC[d]}</span><Badge tone={!doc ? "neutral" : doc.status === "approved" ? "ok" : "warn"}>{!doc ? "Not uploaded" : doc.status === "approved" ? "Approved" : "Awaiting review"}</Badge></li>; })}</ul>
            <ActionForm action={uploadDocumentAction} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2" resetOnSuccess>
              <div><label className="label" htmlFor="docType">Document</label><select id="docType" name="docType" className="input">{REQUIRED_DOCS.map((d) => <option key={d} value={d}>{DOC[d]}</option>)}<option value="reference">Reference letter</option><option value="qualification">Qualification</option></select></div>
              <div><label className="label" htmlFor="expiresOn">Expiry date (if any)</label><input id="expiresOn" name="expiresOn" type="date" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="file">File (PDF, JPG, PNG or WebP · max 10 MB)</label><input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="input" /></div>
              <div className="sm:col-span-2"><Submit pendingText="Uploading…">Upload securely</Submit></div>
            </ActionForm>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Profile photo">
            <div className="flex items-center gap-4"><Avatar name={n.displayName} src={n.photoKey ? `/api/photos/${n.id}` : null} size={72} /><p className="text-[13px] text-muted">A clear, friendly head-and-shoulders photo. Changes after approval are reviewed by Omega.</p></div>
            <ActionForm action={photoChangeAction} className="mt-4 flex flex-wrap gap-2" resetOnSuccess><input name="file" type="file" accept="image/jpeg,image/png,image/webp" required aria-label="Photo" className="input flex-1" /><Submit className="btn-secondary">Upload</Submit></ActionForm>
          </Section>
          <Section title="3. Submit for approval">
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-gold" style={{ width: `${comp.pct}%` }} /></div>
            <p className="text-[14px] font-semibold">{comp.pct}% complete</p>
            {comp.missing.length > 0 && <ul className="mt-2 list-disc pl-5 text-[13px] text-muted">{comp.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
            {["onboarding", "draft"].includes(n.status) && <ActionForm action={submitProfileAction} className="mt-4"><Submit className="btn-primary w-full" pendingText="Submitting…">Submit my profile</Submit></ActionForm>}
            <p className="mt-3 text-[12px] text-muted">Submitting doesn’t make you bookable — Omega completes your vetting checks and approves your profile first.</p>
          </Section>
        </div>
      </div>
    </>
  );
}
