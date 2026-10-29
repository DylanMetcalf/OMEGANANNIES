import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { NannyCard } from "@/components/family/nanny-card";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { freeDays, ratings, searchNannies } from "@/lib/nannies";
import { services } from "@/lib/queries";
import { AREAS, LANGUAGES } from "@/db/seed/reference";

export const metadata = { title: "Find a nanny" };
type SP = { q?: string; service?: string; language?: string; area?: string; age?: string; driver?: string; sort?: string; saved?: string };
export default async function Discover({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  const [familyId] = await familyIdsOf(u.id);
  const favIds = (await db.select().from(s.favourites).where(and(eq(s.favourites.familyId, familyId)))).map((f) => f.nannyId);
  let list = await searchNannies({ ...sp, driver: sp.driver === "1" });
  if (sp.saved === "1") list = list.filter((n) => favIds.includes(n.id));
  const [free, rate, svc] = await Promise.all([freeDays(list.map((n) => n.id)), ratings(list.map((n) => n.id)), services()]);
  const svcNames = Object.fromEntries(svc.map((x) => [x.code, x.name]));
  const sel = (name: keyof SP, label: string, opts: [string, string][]) => (
    <div><label className="label" htmlFor={name}>{label}</label><select id={name} name={name} defaultValue={sp[name] ?? ""} className="input"><option value="">Any</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );
  return (
    <>
      <PageHeader eyebrow="Our nannies" title="Find your nanny" description="Every Omega nanny is personally interviewed, police-clearance verified, First Aid certified and reference checked." />
      <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="sm:col-span-2"><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name, interests, experience…" className="input" /></div>
        {sel("service", "Service", svc.map((x) => [x.code, x.name]))}
        {sel("language", "Language", LANGUAGES.map((l) => [l, l]))}
        {sel("area", "Area", AREAS.map((a) => [a, a]))}
        {sel("age", "Age group", [["newborn", "Newborn"], ["toddler", "Toddler"], ["preschool", "Pre-school"], ["school", "School age"], ["teen", "Teen"]])}
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-6">
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="driver" value="1" defaultChecked={sp.driver === "1"} className="accent-navy" />Drives</label>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="saved" value="1" defaultChecked={sp.saved === "1"} className="accent-navy" />Saved only</label>
          <label className="flex items-center gap-2 text-[14px]">Sort <select name="sort" defaultValue={sp.sort ?? ""} className="input !w-auto !py-1.5"><option value="">Most experienced</option><option value="name">Name</option></select></label>
          <div className="ml-auto flex gap-2"><Link href="/family/nannies" className="btn-ghost">Reset</Link><button className="btn-primary">Apply filters</button></div>
        </div>
      </form>
      <form id="compare" action="/family/nannies/compare" className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[14px] text-muted" aria-live="polite">{list.length} {list.length === 1 ? "nanny" : "nannies"}</p>
        <button className="btn-secondary btn-sm">Compare selected</button>
      </form>
      {list.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map((n) => <NannyCard key={n.id} n={n} saved={favIds.includes(n.id)} free={free[n.id]} rating={rate[n.id]} svcNames={svcNames} compare />)}</div>
        : <Empty title="No nannies match those filters" action={<Link href="/family/nannies" className="btn-secondary">Clear filters</Link>}>Try fewer filters, or message us — we often have nannies who aren&rsquo;t listed publicly yet.</Empty>}
    </>
  );
}
