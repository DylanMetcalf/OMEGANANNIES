import Link from "next/link";
import { X } from "lucide-react";
import { NannyPhoto } from "@/components/family/nanny-photo";
import { ShortlistButton } from "@/components/family/shortlist-button";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { availabilityFor, getDraft, ratingsFor, shortlistOf, visibleNannies } from "@/lib/journey";
import { compareRows } from "@/lib/journey-core";
import { services } from "@/lib/queries";
import { selectNannyAction } from "../../journey-actions";

export const metadata = { title: "Compare nannies" };
export default async function Compare({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const u = await requireUser({ role: "family" });
  const raw = (await searchParams).ids;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? raw.split(",") : []).filter((x) => /^[0-9a-f-]{36}$/.test(x)))].slice(0, 4);
  const [familyId] = await familyIdsOf(u.id);
  const [all, d, svcList, shortlist] = await Promise.all([visibleNannies(), getDraft(familyId), services(), shortlistOf(familyId)]);
  const list = ids.map((id) => all.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  if (list.length < 2) return <><PageHeader title="Compare nannies" /><Empty title="Choose at least two nannies" action={<Link className="btn-primary" href="/family/shortlist">Back to shortlist</Link>}>Tick &ldquo;Compare&rdquo; on two to four shortlisted profiles.</Empty></>;
  const [avail, ratings] = await Promise.all([availabilityFor(ids, d.req), ratingsFor(ids)]);
  const svc = Object.fromEntries(svcList.map((x) => [x.code, x.name]));
  const data = list.map((n) => ({ n, rows: compareRows({ ...n, availability: avail[n.id] ?? null, rating: ratings[n.id] ?? null }, svc) }));
  const without = (id: string) => `?${new URLSearchParams(ids.filter((x) => x !== id).map((x) => ["ids", x]))}`;
  return (
    <>
      <PageHeader eyebrow="Compare" title="Side by side" description="Public profile facts only. Availability reflects your current dates." actions={<Link className="btn-secondary" href="/family/shortlist">Back to shortlist</Link>} />
      <div tabIndex={0} role="region" aria-label="Comparison — scroll sideways on small screens" className="card overflow-x-auto focus-visible:outline-2">
        <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-32 bg-surface p-3" scope="col"><span className="sr-only">Detail</span></th>
              {data.map(({ n }) => (
                <th key={n.id} scope="col" className="min-w-[180px] p-3 align-top font-normal">
                  <div className="relative overflow-hidden rounded-[12px]"><NannyPhoto name={n.displayName} src={n.photoUrl} ratio="aspect-[4/3]" sizes="240px" />
                    {list.length > 2 && <Link href={without(n.id)} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface/95 shadow-sm" aria-label={`Remove ${n.displayName} from comparison`}><X aria-hidden className="h-4 w-4" /></Link>}
                  </div>
                  <Link href={`/family/nannies/${n.slug}`} className="mt-2 block font-display text-[17px] font-bold text-ink hover:underline">{n.displayName}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data[0].rows.map(([label], i) => (
              <tr key={label} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface p-3 text-[12px] font-semibold uppercase tracking-wider text-muted">{label}</th>
                {data.map(({ n, rows }) => <td key={n.id} className="p-3 align-top">{rows[i][1]}</td>)}
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="sticky left-0 bg-surface p-3" />
              {data.map(({ n }) => <td key={n.id} className="space-y-2 p-3"><form action={selectNannyAction}><input type="hidden" name="nannyId" value={n.id} /><button className="btn-cta btn-sm w-full">Select {n.displayName.split(" ")[0]}</button></form><ShortlistButton nannyId={n.id} name={n.displayName} saved={shortlist.includes(n.id)} variant="button" /></td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
