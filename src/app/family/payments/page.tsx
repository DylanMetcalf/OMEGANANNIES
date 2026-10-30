import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";
import { paymentProvider } from "@/lib/payments/service";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Payments" };
export default async function Payments() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const inv = await db.select({ i: s.invoices, ref: s.bookings.reference, bid: s.bookings.id }).from(s.invoices).innerJoin(s.bookings, eq(s.bookings.id, s.invoices.bookingId)).where(eq(s.bookings.familyId, familyId)).orderBy(desc(s.invoices.createdAt));
  const pays = inv.length ? await db.select().from(s.payments).where(inArray(s.payments.invoiceId, inv.map((x) => x.i.id))).orderBy(desc(s.payments.createdAt)) : [];
  const refunds = pays.length ? await db.select().from(s.refunds).where(inArray(s.refunds.paymentId, pays.map((p) => p.id))) : [];
  const quotes = await db.select({ q: s.quotations, ref: s.bookings.reference, bid: s.bookings.id }).from(s.quotations).innerJoin(s.bookings, eq(s.bookings.id, s.quotations.bookingId)).where(eq(s.bookings.familyId, familyId)).orderBy(desc(s.quotations.createdAt));
  const outstanding = inv.filter((x) => x.i.status === "open").reduce((a, x) => a + x.i.amountMinor - x.i.paidMinor, 0);
  const paid = pays.filter((p) => p.status === "succeeded").reduce((a, p) => a + p.amountMinor, 0);
  return (
    <>
      <PageHeader eyebrow="Payments" title="Quotations, invoices & receipts" description={paymentProvider() ? "Card payments are processed securely by our payment provider. We never see or store your card details." : "Online card payment is not yet activated — Omega will share EFT details with your quotation."} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md"><div className="card p-4"><p className="text-[12px] uppercase tracking-wider text-muted">Outstanding</p><p className="font-display text-[30px] text-navy">{formatMoney(outstanding)}</p></div><div className="card p-4"><p className="text-[12px] uppercase tracking-wider text-muted">Paid to date</p><p className="font-display text-[30px] text-navy">{formatMoney(paid)}</p></div></div>
      <div className="space-y-6">
        <Section title="Invoices">
          {inv.length ? <div tabIndex={0} role="region" aria-label="Table — scroll sideways to see more" className="overflow-x-auto focus-visible:outline-2"><table className="tbl"><thead><tr><th>Invoice</th><th>Booking</th><th>Type</th><th className="text-right">Amount</th><th>Status</th></tr></thead><tbody>
            {inv.map(({ i, ref, bid }) => <tr key={i.id}><td className="font-mono text-[13px]">{i.number}</td><td><Link className="link" href={`/family/bookings/${bid}`}>{ref}</Link></td><td className="capitalize">{i.kind}</td><td className="text-right tabular-nums">{formatMoney(i.amountMinor, i.currency)}</td><td className={i.status === "paid" ? "text-ok" : "text-warn"}>{i.status === "paid" ? "Paid" : "Due"}</td></tr>)}
          </tbody></table></div> : <Empty title="No invoices yet">Invoices appear once you accept a quotation.</Empty>}
        </Section>
        <Section title="Payment history & receipts">
          {pays.length ? <div tabIndex={0} role="region" aria-label="Table — scroll sideways to see more" className="overflow-x-auto focus-visible:outline-2"><table className="tbl"><thead><tr><th>Date</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
            {pays.map((p) => <tr key={p.id}><td>{fmtDateTime(p.createdAt)}</td><td className="capitalize">{p.provider === "manual" ? "EFT" : p.provider}</td><td className="text-right tabular-nums">{formatMoney(p.amountMinor, p.currency)}</td><td className="capitalize">{p.status}{refunds.some((r) => r.paymentId === p.id) && <span className="block text-[12px] text-muted">Refund {refunds.find((r) => r.paymentId === p.id)!.status}</span>}</td><td>{p.status === "succeeded" ? <a className="link" href={`/api/receipts/${p.id}`}>Receipt</a> : "—"}</td></tr>)}
          </tbody></table></div> : <p className="text-[14px] text-muted">No payments yet.</p>}
        </Section>
        <Section title="Quotations">
          {quotes.length ? <ul className="divide-y divide-line">{quotes.map(({ q, ref, bid }) => <li key={q.id} className="flex justify-between py-2.5 text-[14px]"><Link className="link" href={`/family/bookings/${bid}`}>{ref} · v{q.version}</Link><span>{formatMoney(q.totalMinor)} · <span className="capitalize text-muted">{q.status}</span></span></li>)}</ul> : <p className="text-[14px] text-muted">No quotations yet.</p>}
        </Section>
      </div>
    </>
  );
}
