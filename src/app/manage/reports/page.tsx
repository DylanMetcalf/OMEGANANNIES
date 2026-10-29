import { Empty, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { services } from "@/lib/queries";
import { report } from "@/lib/reports";
import { STATUS_LABEL, type BookingStatus } from "@/lib/booking-state";

export const metadata = { title: "Reports" };
function Bars({ rows, label, value, fmt = String }: { rows: Record<string, string | number>[]; label: string; value: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value])));
  if (!rows.length) return <Empty title="No data for this period" />;
  return <ul className="space-y-2.5">{rows.map((r) => <li key={String(r[label])} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-[13px]"><span className="truncate">{String(r[label])}</span><span className="h-2.5 overflow-hidden rounded-full bg-sand/70"><span className="block h-full rounded-full bg-navy" style={{ width: `${(Number(r[value]) / max) * 100}%` }} /></span><span className="tabular-nums text-muted">{fmt(Number(r[value]))}</span></li>)}</ul>;
}
export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; service?: string }> }) {
  await requireUser({ perm: "reports.view" });
  const sp = await searchParams;
  const to = sp.to ?? new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const from = sp.from ?? new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const r = await report(from, to, sp.service || undefined);
  const svc = await services();
  const conv = r.totals.created ? Math.round((r.totals.confirmed / r.totals.created) * 100) : null;
  const qs = new URLSearchParams({ from, to, ...(sp.service ? { service: sp.service } : {}) });
  return (
    <>
      <PageHeader eyebrow="Insight" title="Reports" description="Every figure is calculated from stored records. Definitions are in docs/REPORTING.md." actions={<a className="btn-secondary" href={`/api/reports/export?${qs}`}>Export bookings CSV</a>} />
      <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-4">
        <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="service">Service</label><select id="service" name="service" defaultValue={sp.service ?? ""} className="input"><option value="">All</option>{svc.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        <div className="flex items-end"><button className="btn-primary w-full">Update</button></div>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bookings created" value={r.totals.created} hint={`${r.totals.enquiries} from website`} />
        <Stat label="Conversion" value={conv === null ? "—" : `${conv}%`} hint="reached confirmed" />
        <Stat label="Net revenue" value={formatMoney(r.money.revenue - r.money.refunds)} hint={`${formatMoney(r.money.refunds)} refunded`} />
        <Stat label="Outstanding" value={formatMoney(r.money.outstanding)} />
        <Stat label="Avg booking value" value={r.money.avg ? formatMoney(r.money.avg) : "—"} />
        <Stat label="Repeat bookings" value={r.totals.repeat} />
        <Stat label="Cancellations" value={r.totals.cancelled} />
        <Stat label="Avg first response" value={r.responseHours === null ? "—" : `${r.responseHours} h`} hint={`${r.expiringChecks} checks expiring (30d)`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="By status"><Bars rows={r.byStatus.map((x) => ({ ...x, status: STATUS_LABEL[x.status as BookingStatus] ?? x.status }))} label="status" value="n" /></Section>
        <Section title="Service demand"><Bars rows={r.byService} label="service" value="n" /></Section>
        <Section title="Geographic demand"><Bars rows={r.byArea} label="area" value="n" /></Section>
        <Section title="Nanny utilisation (booked hours)"><Bars rows={r.utilisation} label="nanny" value="hours" fmt={(n) => `${n} h`} /></Section>
      </div>
    </>
  );
}
