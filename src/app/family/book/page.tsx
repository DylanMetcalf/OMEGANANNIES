import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { JourneySteps } from "@/components/family/journey-steps";
import { RequirementsForm } from "@/components/family/requirements-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { getDraft } from "@/lib/journey";
import { parseReq, reqToParams } from "@/lib/journey-core";
import { services } from "@/lib/queries";
import { ageLabel } from "@/lib/time";
import { AREAS, LANGUAGES } from "@/db/seed/reference";

export const metadata = { title: "Book a nanny" };
/** Step 1. URL params (from the website, a service page or "Book again") pre-fill on top of the saved draft. */
export default async function BookStart({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  const [familyId] = await familyIdsOf(u.id);
  const [draft, kids, locs, svc] = await Promise.all([getDraft(familyId), db.select().from(s.children).where(eq(s.children.familyId, familyId)), db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId)), services()]);
  const fromUrl = parseReq(sp);
  const req = { ...draft.req, ...Object.fromEntries(Object.entries(fromUrl).filter(([k, v]) => sp[k] !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) } as typeof draft.req;
  if (!req.area && locs[0]) req.area = locs[0].area;
  const areas = [...new Set([...locs.map((l) => l.area), ...AREAS])];
  const resumed = draft.updatedAt && draft.step !== "requirements";
  return (
    <div className="mx-auto max-w-3xl">
      <JourneySteps current={0} />
      <PageHeader eyebrow="Book a nanny" title="Tell us what you need" description="Three quick questions, then we'll show you nannies who fit — with their real availability." />
      {sp.again && <p className="mb-5 rounded-[12px] bg-navy-50 px-4 py-3 text-[14px] text-navy">We&rsquo;ve copied your previous preferences. Choose new dates — availability and prices are checked again.</p>}
      {resumed && !sp.again && <p className="mb-5 rounded-[12px] bg-navy-50 px-4 py-3 text-[14px] text-navy">Welcome back — we kept your answers. <Link className="link" href={`/family/book/nannies?${reqToParams(draft.req)}`}>Jump back to your nanny choices</Link></p>}
      <RequirementsForm req={req} services={svc} kids={kids.map((k) => ({ id: k.id, label: `${k.preferredName} · ${ageLabel(k.dateOfBirth)}` }))} areas={areas} languages={LANGUAGES} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
