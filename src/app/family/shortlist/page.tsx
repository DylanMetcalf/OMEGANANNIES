import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DiscoverCard } from "@/components/family/discover-card";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { availabilityFor, getDraft, ratingsFor, shortlistOf, visibleNannies } from "@/lib/journey";
import { reqToParams } from "@/lib/journey-core";
import { services } from "@/lib/queries";

export const metadata = { title: "Shortlist" };
export default async function Shortlist() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const [ids, all, d, svcList] = await Promise.all([shortlistOf(familyId), visibleNannies(), getDraft(familyId), services()]);
  const list = ids.map((id) => all.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const [avail, ratings] = await Promise.all([availabilityFor(list.map((n) => n.id), d.req), ratingsFor(list.map((n) => n.id))]);
  const svc = Object.fromEntries(svcList.map((x) => [x.code, x.name]));
  const qs = reqToParams(d.req);
  return (
    <>
      <PageHeader eyebrow="Your shortlist" title={list.length ? `${list.length} nann${list.length === 1 ? "y" : "ies"} saved` : "Your shortlist"} description="Saved profiles stay here until you remove them. Compare side by side, then choose your preferences."
        actions={list.length ? <Link href="/family/book/review" className="btn-cta">Continue to request<ArrowRight aria-hidden className="h-4 w-4" /></Link> : undefined} />
      {list.length ? (
        <form action="/family/nannies/compare">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-navy-50 px-4 py-3">
            <p className="text-[14px] text-navy">Tick two to four nannies to compare them side by side.</p>
            <button className="btn-secondary btn-sm">Compare selected</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((n) => (
              <div key={n.id} className="relative">
                <label className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-surface/95 px-2.5 py-1.5 text-[12px] font-semibold shadow-sm ring-1 ring-line"><input type="checkbox" name="ids" value={n.id} className="h-4 w-4 accent-navy" />Compare</label>
                <DiscoverCard n={{ ...n, availability: avail[n.id] ?? null, rating: ratings[n.id] ?? null, reasons: [] }} saved previewHref={`/family/nannies/${n.slug}`} svc={svc} />
              </div>
            ))}
          </div>
        </form>
      ) : <Empty title="Nothing saved yet" action={<Link href={`/family/book/nannies?${qs}`} className="btn-primary">Browse nannies</Link>}>Tap the bookmark on any nanny to save them here.</Empty>}
    </>
  );
}
