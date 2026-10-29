import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { signDocumentUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { uploadDocumentAction } from "../actions";

export const metadata = { title: "Documents" };
const TYPES: Record<string, string> = { police_clearance: "Police clearance", first_aid: "First Aid certificate", id_document: "Identity document", reference: "Reference letter", qualification: "Qualification", other: "Other" };
const CHECK: Record<string, string> = { interview: "Interview", reference: "References", identity: "Identity", police_clearance: "Police clearance", first_aid: "First Aid" };
export default async function Documents() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked" />;
  const docs = await db.select().from(s.documents).where(eq(s.documents.ownerNannyId, n.id)).orderBy(desc(s.documents.createdAt));
  const checks = await db.select().from(s.verificationChecks).where(eq(s.verificationChecks.nannyId, n.id));
  const tone = (st: string) => (st === "approved" || st === "passed" ? "ok" : st === "rejected" || st === "failed" || st === "expired" ? "bad" : "warn");
  return (
    <>
      <PageHeader eyebrow="Documents" title="Vetting & documents" description="Stored privately. Only you and authorised Omega staff can open these files, and every view is logged." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section title="Upload a document">
            <ActionForm action={uploadDocumentAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <div><label className="label" htmlFor="docType">Type</label><select id="docType" name="docType" className="input">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="label" htmlFor="expiresOn">Expiry date (if any)</label><input id="expiresOn" name="expiresOn" type="date" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="file">File</label><input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="input" /><p className="mt-1 text-[12px] text-muted">PDF, JPG, PNG or WebP, up to 10 MB.</p></div>
              <div className="sm:col-span-2"><Submit pendingText="Uploading…">Upload securely</Submit></div>
            </ActionForm>
          </Section>
          <Section title="Your documents">
            {docs.length ? <ul className="divide-y divide-line">{docs.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[14px]"><div><p className="font-medium text-navy">{TYPES[d.docType]}</p><p className="text-[12px] text-muted">{d.fileName} · uploaded {fmtDateTime(d.createdAt)}{d.expiresOn && ` · expires ${fmtDate(d.expiresOn)}`}</p>{d.reviewNote && <p className="text-[12px] text-muted">Note: {d.reviewNote}</p>}</div><div className="flex items-center gap-2"><Badge tone={tone(d.status)}>{d.status.replace("_", " ")}</Badge><a className="link text-[13px]" href={signDocumentUrl(d.id, u.id)}>View</a></div></li>)}</ul> : <Empty title="No documents uploaded" />}
          </Section>
        </div>
        <Section title="Vetting status">
          <ul className="space-y-3">{Object.entries(CHECK).map(([k, l]) => { const c = checks.find((x) => x.kind === k); return <li key={k} className="flex items-center justify-between text-[14px]"><span>{l}{c?.expiresOn && <span className="block text-[12px] text-muted">Valid until {fmtDate(c.expiresOn)}</span>}</span><Badge tone={c ? tone(c.status) : "neutral"}>{c?.status ?? "not started"}</Badge></li>; })}</ul>
          <p className="mt-4 text-[12px] text-muted">We remind you 30 days before anything expires.</p>
        </Section>
      </div>
    </>
  );
}
