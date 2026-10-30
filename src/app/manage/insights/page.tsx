import Form from "next/form";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { BarList, Columns } from "@/components/charts";
import { Notice, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { STATUSES, STATUS_LABEL, type BookingStatus } from "@/lib/booking-state";
import { insights } from "@/lib/insights";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { services } from "@/lib/queries";
import { AREAS } from "@/db/seed/reference";

export const metadata = { title: "Insights" };
type SP = { from?: string; to?: string; service?: string; area?: string; status?: string; nanny?: string };
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function Insights({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser({ perm: "reports.view" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const f = {
    from: isDate(sp.from) ? sp.from! : new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10), to: isDate(sp.to) ? sp.to! : today,
    service: sp.service || undefined, area: sp.area || undefined, status: (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined, nannyId: /^[0-9a-f-]{36}$/.test(sp.nanny ?? "") ? sp.nanny : undefined,
  };
  const [d, svc, nannies] = await Promise.all([insights(f), services(), db.select({ id: s.nannies.id, name: s.nannies.displayName }).from(s.nannies).where(eq(s.nannies.status, "approved")).orderBy(s.nannies.displayName)]);
  const money = can(u, "payments.manage");
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const zar = (n: number) => formatMoney(n);
  return (
    <>
      <PageHeader eyebrow="Insights" title="How Omega is doing" description="Live figures from bookings, profiles and payments. Nothing is estimated or projected." actions={<a href={`/api/reports/insights?${qs}`} className="btn-secondary">Export CSV</a>} />
      <Form action="/manage/insights" className="card mb-6 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7">
        <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={f.from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={f.to} className="input" /></div>
        <div><label className="label" htmlFor="service">Service</label><select id="service" name="service" defaultValue={f.service ?? ""} className="input"><option value="">All</option>{svc.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        <div><label className="label" htmlFor="area">Area</label><select id="area" name="area" defaultValue={f.area ?? ""} className="input"><option value="">All</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></div>
        <div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={f.status ?? ""} className="input"><option value="">All</option>{STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x as BookingStatus]}</option>)}</select></div>
        <div><label className="label" htmlFor="nanny">Nanny</label><select id="nanny" name="nanny" defaultValue={f.nannyId ?? ""} className="input"><option value="">All</option>{nannies.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
        <div className="flex items-end"><button className="btn-primary w-full">Update</button></div>
      </Form>

      <h2 className="mb-3 text-[18px]">Overview</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Booking requests" value={d.ov.requests} hint="created in range" />
        <Stat label="Confirmed" value={d.ov.confirmed} hint={d.ov.conversion !== null ? `${d.ov.conversion}% conversion` : "—"} />
        <Stat label="Cancelled" value={d.ov.cancelled} />
        <Stat label="New families" value={d.ov.families} />
        <Stat label="New nanny accounts" value={d.ov.nannyAccounts} hint="claimed in range" />
        <Stat label="Active profiles" value={d.ov.active} hint="approved & published" />
        <Stat label="Awaiting approval" value={d.ov.pending} href="/manage/nannies?f=review" />
        <Stat label="Open quotations" value={d.ov.openQuotes} />
        <Stat label="Starting in 14 days" value={d.ov.upcoming} />
        <Stat label="Open tasks" value={d.ov.tasks} href="/manage/tasks" />
        <Stat label="Avg. lead time" value={d.leadDays !== null ? `${d.leadDays} d` : "—"} hint="request → first care day" />
        <Stat label="Returning families" value={d.repeat?.returning ?? 0} hint={d.repeat?.perFamily ? `${d.repeat.perFamily} bookings per family` : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Bookings"><div className="space-y-6"><Columns title="Requests per week" rows={d.weekly.map((w) => ({ label: w.week, n: w.n }))} /><BarList title="Status" rows={d.statuses.map((x) => ({ label: STATUS_LABEL[x.label as BookingStatus] ?? x.label, n: x.n }))} /></div></Section>
        <Section title="Demand"><div className="space-y-6"><BarList title="By service" rows={d.svc} /><BarList title="By area" rows={d.areas} /></div></Section>
        <Section title="Nannies"><div className="space-y-6"><BarList title="Profiles by stage" rows={d.funnel} /><BarList title="Booked hours in range" rows={d.util} format={(n) => `${n} h`} /><BarList title="Chosen as a family preference" rows={d.prefs} empty="No preferences recorded in this range." /></div></Section>
        <Section title="Families & reviews">
          <div className="mb-5 grid grid-cols-2 gap-3"><Stat label="Shortlist saves" value={d.fam?.shortlisted ?? 0} /><Stat label="Profile views" value={d.fam?.views ?? 0} /><Stat label="Referred sign-ups" value={d.fam?.referrals ?? 0} /><Stat label="Families booking" value={d.repeat?.families ?? 0} /></div>
          <BarList title="Average published rating by month" rows={d.monthlyRatings.map((m) => ({ label: `${m.month} (${m.n})`, n: m.avg }))} format={(n) => n.toFixed(2)} empty="No published reviews in this range." />
        </Section>
        {money ? (
          <Section title="Commercial" className="xl:col-span-2">
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Quoted" value={zar(d.money.quoted)} hint="quotations sent" />
              <Stat label="Booked" value={zar(d.money.booked)} hint="quotations accepted" />
              <Stat label="Invoiced" value={zar(d.money.invoiced)} />
              <Stat label="Collected" value={zar(d.money.collected)} hint="verified payments" />
              <Stat label="Outstanding" value={zar(d.money.outstanding)} hint="all open invoices" />
              <Stat label="Refunded" value={zar(d.money.refunds)} />
            </div>
            <Columns title="Collected per month" rows={d.monthlyCollected.map((m) => ({ label: m.month, n: m.n }))} format={zar} />
            <p className="mt-3 text-[12px] text-muted">Only “Collected” is money received. Quoted and booked values are not revenue until paid.</p>
          </Section>
        ) : <Notice tone="info">Commercial figures need the payments permission.</Notice>}
      </div>
    </>
  );
}
