import { DefList, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, minutesToHHMM } from "@/lib/time";
import { STATUS_LABEL, type BookingStatus } from "@/lib/booking-state";
import type { BookingDetail } from "@/lib/queries";
import type { QuoteLine } from "@/lib/pricing";

export const dates = (b: { startDate: string; endDate: string }) => (b.startDate === b.endDate ? fmtDate(b.startDate) : `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const hours = (b: { dailyStartMinute: number; dailyEndMinute: number; liveIn: boolean; weekdays?: number[] | null }) =>
  b.liveIn ? "24/7 live-in" : `${minutesToHHMM(b.dailyStartMinute)}–${minutesToHHMM(b.dailyEndMinute)}${b.weekdays?.length ? ` · ${[...b.weekdays].sort((a, c) => ((a + 6) % 7) - ((c + 6) % 7)).map((w) => WD[w]).join(", ")}` : ""}`;

const JOURNEY: BookingStatus[] = ["enquiry", "matching", "quotation", "awaiting_approval", "awaiting_payment", "confirmed", "completed"];
/** Visual progress for families: where the booking is and what happens next. */
export function Journey({ status }: { status: BookingStatus }) {
  const map: Partial<Record<BookingStatus, BookingStatus>> = { introduction: "matching", in_progress: "confirmed" };
  const idx = JOURNEY.indexOf(map[status] ?? status);
  if (idx < 0) return <StatusBadge status={status} />;
  return (
    <div>
    <p className="mb-2 text-[13px] font-medium text-navy sm:hidden">Step {idx + 1} of {JOURNEY.length}: {STATUS_LABEL[status]}</p>
    <ol className="grid grid-cols-7 gap-1" aria-label="Booking progress">
      {JOURNEY.map((st, i) => (
        <li key={st} className="flex flex-col gap-1.5" aria-current={i === idx ? "step" : undefined}>
          <span className={`h-1.5 rounded-full ${i <= idx ? "bg-gold" : "bg-sand"}`} />
          <span className={`hidden text-[11px] sm:block ${i === idx ? "font-semibold text-navy" : "text-muted"}`}>{STATUS_LABEL[st].replace("Quote ready for you", "Quote ready")}</span>
        </li>
      ))}
    </ol>
    </div>
  );
}

export function BookingFacts({ d, showPreciseLocation }: { d: BookingDetail; showPreciseLocation: boolean }) {
  const { b } = d;
  return (
    <DefList items={[
      ["Reference", <span key="r" className="font-mono text-[13px]">{b.reference}</span>],
      ["Service", d.serviceName],
      ["Dates", dates(b)],
      ["Hours", hours(b)],
      ["Area", d.location?.area ?? b.areaText],
      ["Address", showPreciseLocation ? (d.location?.addressLine ?? null) : <span key="a" className="text-muted">Shared with your nanny once confirmed</span>],
      ["Children", d.children.map((c) => c.preferredName).join(", ") || b.enquiryChildren],
      ["Nanny", d.nanny?.displayName ?? <span key="n" className="text-muted">Being matched</span>],
      ...(b.specialRequests ? [["Special requests", b.specialRequests] as [string, string]] : []),
    ]} />
  );
}

export function QuoteTable({ lines, total, deposit, adjustment, adjustmentReason, currency = "ZAR" }: { lines: QuoteLine[]; total: number; deposit: number; adjustment?: number; adjustmentReason?: string | null; currency?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Item</th><th>Qty</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="text-muted">{l.qty}</td><td className="text-right tabular-nums">{formatMoney(l.totalMinor, currency)}</td></tr>)}
          {!!adjustment && <tr><td>Adjustment{adjustmentReason ? ` — ${adjustmentReason}` : ""}</td><td /><td className="text-right tabular-nums">{formatMoney(adjustment, currency)}</td></tr>}
          <tr><td className="font-semibold text-navy">Total</td><td /><td className="text-right font-semibold tabular-nums text-navy">{formatMoney(total, currency)}</td></tr>
          <tr><td className="text-muted">Deposit to confirm</td><td /><td className="text-right tabular-nums text-muted">{formatMoney(deposit, currency)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ events, showInternal }: { events: BookingDetail["events"]; showInternal: boolean }) {
  const list = events.filter((x) => showInternal || !x.e.internal);
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {list.map(({ e, actor }) => (
        <li key={e.id} className="relative">
          <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${e.kind === "status" ? "bg-gold" : e.internal ? "bg-navy/30" : "bg-navy"}`} />
          <p className="text-[14px]">
            {e.toStatus && e.kind === "status" ? <strong className="font-medium text-navy">{STATUS_LABEL[e.toStatus]}</strong> : <strong className="font-medium capitalize text-navy">{e.kind.replace("_", " ")}</strong>}
            {e.internal && <span className="ml-2 rounded bg-navy-50 px-1.5 text-[11px] text-navy">internal</span>}
          </p>
          {e.note && <p className="text-[13px] text-muted">{e.note}</p>}
          <p className="text-[12px] text-muted">{fmtDateTime(e.createdAt)}{actor ? ` · ${actor}` : " · System"}</p>
        </li>
      ))}
    </ol>
  );
}

export function InvoiceRows({ invoices, payments, action }: { invoices: BookingDetail["invoices"]; payments: BookingDetail["payments"]; action?: (inv: BookingDetail["invoices"][number]) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Invoice</th><th>Type</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {invoices.map((inv) => {
            const p = payments.filter((x) => x.invoiceId === inv.id);
            return (
              <tr key={inv.id}>
                <td className="font-mono text-[13px]">{inv.number}</td>
                <td className="capitalize">{inv.kind}</td>
                <td className="text-right tabular-nums">{formatMoney(inv.amountMinor, inv.currency)}</td>
                <td>
                  <span className={inv.status === "paid" ? "text-ok" : "text-warn"}>{inv.status === "paid" ? "Paid" : inv.paidMinor ? `Part-paid (${formatMoney(inv.paidMinor)})` : "Due"}</span>
                  {p.some((x) => x.status === "failed") && <p className="text-[12px] text-bad">A payment attempt failed</p>}
                  {p.some((x) => x.status === "pending" || x.status === "initiated") && inv.status !== "paid" && <p className="text-[12px] text-muted">Awaiting provider confirmation</p>}
                </td>
                <td className="text-right">{action?.(inv)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
