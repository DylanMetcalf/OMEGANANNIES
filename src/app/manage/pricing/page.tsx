import { asc, desc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";
import { newPriceDraftAction, publishPriceBookAction, savePriceItemAction } from "../actions";

export const metadata = { title: "Pricing" };
const show = (unit: string, amount: number) => (unit === "bps" ? `${amount / 100}%` : unit === "hours" ? `${amount} h` : formatMoney(amount));
const edit = (unit: string, amount: number) => (unit === "bps" ? String(amount / 100) : unit === "hours" ? String(amount) : (amount / 100).toFixed(2));
export default async function Pricing() {
  await requireUser({ perm: "pricing.manage" });
  const books = await db.select().from(s.priceBooks).orderBy(desc(s.priceBooks.version));
  const items = await db.select().from(s.priceItems).orderBy(asc(s.priceItems.code));
  return (
    <>
      <PageHeader eyebrow="Configuration" title="Pricing administration" description="Versioned price books with effective dates. Quotations snapshot their line items, so publishing new prices never changes an accepted quotation or confirmed booking." actions={<ActionForm action={newPriceDraftAction} className="flex gap-2"><input name="label" required placeholder="New draft label" aria-label="Draft label" className="input" /><Submit className="btn-primary">New draft</Submit></ActionForm>} />
      <div className="mb-6"><Notice tone="warn" title="Business confirmation needed">The public site lists different rates on /rates (R300/h, R2 200/day) and service pages (from R200/h, R1 650/day). v1 uses /rates. Items marked &ldquo;TO CONFIRM&rdquo; are placeholders not published on the website.</Notice></div>
      <div className="space-y-6">
        {books.map((b) => {
          const its = items.filter((i) => i.priceBookId === b.id);
          const draft = b.status === "draft";
          return (
            <Section key={b.id} title={`v${b.version} · ${b.label}`} action={<span className="flex items-center gap-2"><Badge tone={b.status === "published" ? "ok" : draft ? "gold" : "neutral"}>{b.status}</Badge>{b.effectiveFrom && <span className="text-[12px] text-muted">from {fmtDateTime(b.effectiveFrom)}</span>}</span>}>
              <div tabIndex={0} role="region" aria-label="Table — scroll sideways to see more" className="overflow-x-auto focus-visible:outline-2"><table className="tbl min-w-[640px]"><thead><tr><th>Code</th><th>Label</th><th>Audience</th><th>Unit</th><th className="text-right">Amount</th></tr></thead><tbody>
                {its.map((i) => <tr key={i.id}><td className="font-mono text-[12px]">{i.code}</td>
                  <td>{draft ? <ActionForm action={savePriceItemAction} className="flex gap-2"><input type="hidden" name="itemId" value={i.id} /><input name="label" defaultValue={i.label} aria-label="Label" className="input !py-1 text-[13px]" /><input name="amount" defaultValue={edit(i.unit, i.amount)} aria-label="Amount" className="input !w-28 !py-1 text-right text-[13px]" /><Submit className="btn-ghost btn-sm">Save</Submit></ActionForm> : i.label}</td>
                  <td className="capitalize">{i.audience}{i.serviceCode && ` · ${i.serviceCode}`}</td><td>{i.unit}</td><td className="text-right tabular-nums">{show(i.unit, i.amount)}</td></tr>)}
              </tbody></table></div>
              {draft && <ActionForm action={publishPriceBookAction} confirm="Publish this price book? New quotations will use it from the effective date." className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"><input type="hidden" name="priceBookId" value={b.id} /><div><label className="label" htmlFor={`eff-${b.id}`}>Effective from</label><input id={`eff-${b.id}`} name="effectiveFrom" type="date" className="input" /></div><Submit className="btn-gold">Publish</Submit></ActionForm>}
            </Section>
          );
        })}
      </div>
    </>
  );
}
