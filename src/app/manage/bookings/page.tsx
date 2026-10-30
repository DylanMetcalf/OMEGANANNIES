import Link from "next/link";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { dates, hours } from "@/components/booking/parts";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { STATUSES, STATUS_LABEL, type BookingStatus } from "@/lib/booking-state";
import { services } from "@/lib/queries";

export const metadata = { title: "Bookings" };
export default async function ManageBookings({ searchParams }: { searchParams: Promise<{ status?: string; service?: string; q?: string; page?: string }> }) {
  await requireUser({ perm: "bookings.view" });
  const sp = await searchParams;
  const PAGE = 50;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const conds: SQL[] = [];
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) conds.push(eq(s.bookings.status, sp.status as BookingStatus));
  if (sp.service) conds.push(eq(s.bookings.serviceCode, sp.service));
  if (sp.q) conds.push(or(ilike(s.bookings.reference, `%${sp.q}%`), ilike(s.families.displayName, `%${sp.q}%`), ilike(s.bookings.enquiryName, `%${sp.q}%`), ilike(s.nannies.displayName, `%${sp.q}%`))!);
  const rows = await db.select({ b: s.bookings, nanny: s.nannies.displayName, family: s.families.displayName }).from(s.bookings).leftJoin(s.nannies, eq(s.nannies.id, s.bookings.nannyId)).leftJoin(s.families, eq(s.families.id, s.bookings.familyId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(s.bookings.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE; if (hasNext) rows.pop();
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), ...(sp.service ? { service: sp.service } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  const svc = await services();
  const sv = Object.fromEntries(svc.map((x) => [x.code, x.name]));
  return (
    <>
      <PageHeader eyebrow="Operations" title="Bookings & enquiries" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_200px_200px_auto]" role="search">
        <div><label htmlFor="q" className="label">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Reference, family, nanny" className="input" /></div>
        <div><label htmlFor="status" className="label">Status</label><select id="status" name="status" defaultValue={sp.status ?? ""} className="input"><option value="">All</option>{STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select></div>
        <div><label htmlFor="service" className="label">Service</label><select id="service" name="service" defaultValue={sp.service ?? ""} className="input"><option value="">All</option>{svc.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        <div className="flex items-end"><button className="btn-primary w-full">Filter</button></div>
      </form>
      {rows.length ? (
        <div tabIndex={0} role="region" aria-label="Table — scroll sideways to see more" className="card overflow-x-auto focus-visible:outline-2">
          <table className="tbl min-w-[860px]">
            <thead><tr><th>Reference</th><th>Family</th><th>Service</th><th>Dates</th><th>Nanny</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>{rows.map(({ b, nanny, family }) => (
              <tr key={b.id} className="hover:bg-cream/40">
                <td><Link href={`/manage/bookings/${b.id}`} className="font-mono text-[13px] link">{b.reference}</Link></td>
                <td>{family ?? <span>{b.enquiryName} <span className="text-[12px] text-muted">(no account)</span></span>}</td>
                <td>{sv[b.serviceCode]}</td><td className="whitespace-nowrap">{dates(b)}<span className="block text-[12px] text-muted">{hours(b)}</span></td>
                <td>{nanny ?? <span className="text-warn">Unassigned</span>}</td><td><StatusBadge status={b.status} /></td><td className="capitalize text-muted">{b.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty title="No bookings match" />}
      {(page > 1 || hasNext) && <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[14px]">{page > 1 ? <Link className="btn-secondary btn-sm" href={qs(page - 1)}>Previous</Link> : <span />}<span className="text-muted">Page {page}</span>{hasNext ? <Link className="btn-secondary btn-sm" href={qs(page + 1)}>Next</Link> : <span />}</nav>}
    </>
  );
}
