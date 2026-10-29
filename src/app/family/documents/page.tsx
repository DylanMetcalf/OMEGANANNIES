import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { signDocumentUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/time";
import { deleteFamilyDocumentAction, uploadFamilyDocumentAction } from "../actions";

export const metadata = { title: "Documents" };
const TYPES: Record<string, string> = { medical_note: "Medical or care note", travel_document: "Travel / itinerary", booking_document: "Booking document", other: "Other" };
export default async function FamilyDocuments() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const docs = await db.select().from(s.documents).where(eq(s.documents.ownerFamilyId, familyId)).orderBy(desc(s.documents.createdAt));
  return (
    <>
      <PageHeader eyebrow="Household" title="Documents" description="Share files with the Omega team, such as a care plan or travel itinerary. Files are stored privately and every view is logged." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Your files">
          {docs.length ? <ul className="divide-y divide-line">{docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[14px]">
              <div><p className="font-semibold">{TYPES[d.docType] ?? d.docType}</p><p className="text-[12px] text-muted">{d.fileName} · {fmtDateTime(d.createdAt)}</p></div>
              <div className="flex items-center gap-2"><a className="link text-[13px]" target="_blank" rel="noopener noreferrer" href={signDocumentUrl(d.id, u.id)}>Open</a>
                <ActionForm action={deleteFamilyDocumentAction} confirm="Delete this file?"><input type="hidden" name="documentId" value={d.id} /><Submit className="btn-ghost btn-sm" pendingText="Deleting…">Delete</Submit></ActionForm></div>
            </li>
          ))}</ul> : <Empty title="No documents yet" />}
        </Section>
        <Section title="Upload a file">
          <ActionForm action={uploadFamilyDocumentAction} className="space-y-3" resetOnSuccess>
            <div><label className="label" htmlFor="docType">Type</label><select id="docType" name="docType" className="input">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="label" htmlFor="file">File (PDF, JPG, PNG or WebP · max 10 MB)</label><input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="input" /></div>
            <Submit pendingText="Uploading…">Upload securely</Submit>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
