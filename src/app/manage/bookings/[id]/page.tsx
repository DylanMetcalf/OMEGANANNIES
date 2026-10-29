import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { BookingFacts, InvoiceRows, QuoteTable, Timeline } from "@/components/booking/parts";
import { Badge, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nextStatuses, STATUS_LABEL } from "@/lib/booking-state";
import { priceBooking } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { bookingDetail } from "@/lib/queries";
import { ageLabel, fmtDateTime, minutesToHHMM } from "@/lib/time";
import type { Reason } from "@/lib/matching";
import type { QuoteLine } from "@/lib/pricing";
import * as A from "../../actions";

export const metadata = { title: "Booking workspace" };
export default async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser({ perm: "bookings.view" });
  const d = await bookingDetail((await params).id);
  if (!d) notFound();
  const { b } = d;
  const manage = can(u, "bookings.manage");
  const sensitive = can(u, "sensitive.view");
  const matches = await db.select({ m: s.matchResults, n: s.nannies }).from(s.matchResults).innerJoin(s.nannies, eq(s.nannies.id, s.matchResults.nannyId)).where(eq(s.matchResults.bookingId, b.id)).orderBy(desc(s.matchResults.eligible), desc(s.matchResults.score));
  const refunds = d.payments.length ? await db.select().from(s.refunds).where(inArray(s.refunds.paymentId, d.payments.map((p) => p.id))) : [];
  let estimate: Awaited<ReturnType<typeof priceBooking>> | null = null, estimateError = "";
  try { estimate = await priceBooking(b); } catch (e) { estimateError = (e as Error).message; }
  const next = manage ? nextStatuses(b.status, "management").filter((x) => x !== "confirmed" && x !== "quotation" && x !== "awaiting_approval") : [];
  const editable = ["enquiry", "matching", "introduction", "quotation", "awaiting_approval"].includes(b.status);
  const H = `b-${b.id}`;
  const hidden = <input type="hidden" name="bookingId" value={b.id} />;
  return (
    <>
      <PageHeader eyebrow={`${b.reference} · ${b.source}`} title={d.family?.displayName ?? b.enquiryName ?? "Booking"} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={b.status} /><span>{d.serviceName}</span>{b.isDemo && <Badge tone="gold">Demo</Badge>}</span>}
        actions={<>{d.conversation && <Link className="btn-secondary" href={`/messages/${d.conversation.id}`}>Booking chat</Link>}<Link className="btn-ghost" href="/manage/bookings">All bookings</Link></>} />
      {next.length > 0 && (
        <ActionForm action={A.transitionAction} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
          {hidden}
          <div className="min-w-[240px] flex-1"><label className="label" htmlFor={`${H}-note`}>Status change note</label><input id={`${H}-note`} name="note" className="input" placeholder="Required for decline / cancel / dispute" /></div>
          {next.map((x) => <Submit key={x} name="to" value={x} className={["declined", "cancelled", "disputed"].includes(x) ? "btn-danger" : "btn-secondary"}>{STATUS_LABEL[x]}</Submit>)}
        </ActionForm>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="space-y-6">
          <Section title="Request">
            <BookingFacts d={d} showPreciseLocation />
            <div className="mt-4 flex flex-wrap gap-2">
              {b.liveIn && <Badge>Live-in</Badge>}{b.overnight && <Badge>Overnight</Badge>}{b.needsDriver && <Badge tone="info">Driver required</Badge>}{b.specialistCare && <Badge tone="gold">Specialist care</Badge>}
              {b.requiredLanguages.map((l) => <Badge key={l} tone="info">{l}</Badge>)}{b.budgetMaxMinor && <Badge>Budget {formatMoney(b.budgetMaxMinor)}</Badge>}
            </div>
            {!d.family && (
              <div className="mt-5 rounded-xl bg-cream p-4 text-[14px]">
                <p className="font-medium text-navy">Website enquiry — no portal account yet</p>
                <p className="text-muted">{b.enquiryName} · <a className="link" href={`mailto:${b.enquiryEmail}`}>{b.enquiryEmail}</a> · {b.enquiryPhone}</p>
                {can(u, "families.manage") && <ActionForm action={A.convertEnquiryAction} className="mt-3">{hidden}<Submit className="btn-primary btn-sm">Create family &amp; invite to portal</Submit></ActionForm>}
              </div>
            )}
          </Section>
          {d.children.length > 0 && (
            <Section title="Children" action={!sensitive ? <Badge>Medical details hidden</Badge> : null}>
              <ul className="grid gap-3 sm:grid-cols-2">{d.children.map((c) => <li key={c.id} className="rounded-xl border border-line p-3 text-[14px]"><p className="font-medium text-navy">{c.preferredName} · {ageLabel(c.dateOfBirth)}</p>{sensitive ? <>{c.allergies && <p className="text-bad">Allergies: {c.allergies}</p>}{c.additionalNeeds && <p>Needs: {c.additionalNeeds}</p>}{c.routines && <p className="text-muted">{c.routines}</p>}</> : <p className="text-muted">Requires sensitive-data permission.</p>}</li>)}</ul>
            </Section>
          )}
          <Section title="Matching" action={manage && editable ? <ActionForm action={A.runMatchingAction}>{hidden}<Submit className="btn-secondary btn-sm" pendingText="Matching…">{matches.length ? "Re-run" : "Run matching"}</Submit></ActionForm> : null}>
            {d.nanny && <p className="mb-4 text-[14px]">Assigned: <Link className="link" href={`/manage/nannies/${d.nanny.id}`}>{d.nanny.displayName}</Link>{b.requestedNannyId === d.nanny.id && " (requested by family)"}</p>}
            {matches.length ? (
              <ul className="space-y-3">{matches.map(({ m, n }) => {
                const reasons = m.reasons as Reason[];
                return (
                  <li key={m.id} className={`rounded-xl border p-4 ${m.eligible ? "border-line" : "border-bad/20 bg-bad-50/30"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-navy">{n.displayName} {m.eligible ? <Badge tone="ok">Score {m.score}</Badge> : <Badge tone="bad">Ineligible</Badge>}{b.nannyId === n.id && <Badge tone="gold">Assigned</Badge>}</p>
                      {manage && editable && b.nannyId !== n.id && (
                        <ActionForm action={A.assignNannyAction} className="flex gap-2">{hidden}<input type="hidden" name="nannyId" value={n.id} />{!m.eligible && <input name="override" required aria-label="Override reason" placeholder="Override reason (recorded)" className="input !py-1.5 text-[13px]" />}<Submit className={m.eligible ? "btn-primary btn-sm" : "btn-danger btn-sm"}>{m.eligible ? "Assign" : "Override & assign"}</Submit></ActionForm>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">{reasons.map((r, i) => <li key={i} className={r.kind === "hard_fail" ? "text-bad" : r.kind === "review" ? "text-warn" : "text-muted"}>{r.kind === "hard_fail" ? "✕" : r.kind === "review" ? "!" : "✓"} {r.text}</li>)}</ul>
                  </li>
                );
              })}</ul>
            ) : <p className="text-[14px] text-muted">Run matching to rank approved nannies against hard requirements (vetting, availability, service, ages, languages, driving) and preferences. Recommendations only — you decide.</p>}
          </Section>
          <Section title="Quotation">
            {estimate ? <><p className="mb-2 text-[13px] text-muted">Live estimate from price book v{estimate.version} (server-calculated):</p><QuoteTable lines={estimate.lines} total={estimate.subtotalMinor} deposit={estimate.depositMinor} />{estimate.assumptions.length > 0 && <ul className="mt-2 list-disc pl-5 text-[12px] text-muted">{estimate.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}</> : <Notice tone="warn">{estimateError}</Notice>}
            {manage && editable && (
              <ActionForm action={A.createQuoteAction} className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-4">
                {hidden}
                <div><label className="label" htmlFor={`${H}-trips`}>Travel trips</label><input id={`${H}-trips`} name="travelTrips" type="number" min={0} defaultValue={0} className="input" /></div>
                <div><label className="label" htmlFor={`${H}-adj`}>Adjustment (R)</label><input id={`${H}-adj`} name="adjustment" placeholder="-500 or 750" className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor={`${H}-adjr`}>Adjustment reason</label><input id={`${H}-adjr`} name="adjustmentReason" className="input" /></div>
                <div><label className="label" htmlFor={`${H}-valid`}>Valid (days)</label><input id={`${H}-valid`} name="validDays" type="number" min={1} max={30} defaultValue={7} className="input" /></div>
                <div className="flex items-end sm:col-span-3"><Submit className="btn-secondary">Create draft quotation</Submit></div>
              </ActionForm>
            )}
            {d.quotes.length > 0 && <ul className="mt-5 space-y-3 border-t border-line pt-5">{d.quotes.map((q) => (
              <li key={q.id}>
                <details open={q.status === "draft"}>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-[14px]"><span>v{q.version} · <strong>{formatMoney(q.totalMinor)}</strong> · deposit {formatMoney(q.depositMinor)}</span><Badge tone={q.status === "accepted" ? "ok" : q.status === "sent" ? "gold" : "neutral"}>{q.status}</Badge></summary>
                  <div className="mt-3"><QuoteTable lines={q.lines as QuoteLine[]} total={q.totalMinor} deposit={q.depositMinor} adjustment={q.adjustmentMinor} adjustmentReason={q.adjustmentReason} /></div>
                  {q.status === "draft" && manage && <ActionForm action={A.sendQuoteAction} className="mt-3">{hidden}<input type="hidden" name="quotationId" value={q.id} /><Submit className="btn-gold">Send to family</Submit>{!b.nannyId && <span className="ml-3 text-[13px] text-warn">Assign a nanny first</span>}</ActionForm>}
                </details>
              </li>
            ))}</ul>}
          </Section>
          {d.invoices.length > 0 && (
            <Section title="Invoices & payments">
              <InvoiceRows invoices={d.invoices} payments={d.payments} action={(inv) => inv.status === "open" && can(u, "payments.manage") ? <ActionForm action={A.recordPaymentAction} className="flex gap-1.5" confirm="Record this EFT as received? Only do this once funds have cleared.">{hidden}<input type="hidden" name="invoiceId" value={inv.id} /><input name="reference" required aria-label="Bank reference" placeholder="Bank ref" className="input !w-28 !py-1 text-[12px]" /><Submit className="btn-secondary btn-sm">Record EFT</Submit></ActionForm> : null} />
              {d.payments.filter((p) => p.status === "succeeded").length > 0 && can(u, "payments.manage") && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="label">Refunds</p>
                  {refunds.map((r) => <p key={r.id} className="flex items-center justify-between text-[14px]"><span>{formatMoney(r.amountMinor)} · {r.reason} · <span className="capitalize">{r.status}</span></span>{r.status === "pending" && <ActionForm action={A.completeRefundAction}>{hidden}<input type="hidden" name="refundId" value={r.id} /><Submit className="btn-ghost btn-sm">Mark refunded</Submit></ActionForm>}</p>)}
                  <ActionForm action={A.refundAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]">{hidden}
                    <select name="paymentId" aria-label="Payment" className="input">{d.payments.filter((p) => p.status === "succeeded").map((p) => <option key={p.id} value={p.id}>{formatMoney(p.amountMinor)} · {p.provider} · {fmtDateTime(p.createdAt)}</option>)}</select>
                    <input name="amount" required aria-label="Refund amount" placeholder="Amount" className="input" /><input name="reason" required aria-label="Reason" placeholder="Reason" className="input" /><Submit className="btn-danger">Record refund</Submit>
                  </ActionForm>
                </div>
              )}
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Introductions">
            {d.meetings.map((m) => <div key={m.id} className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[14px]"><span>{fmtDateTime(m.startsAt)} · {m.provider.replace("_", " ")}{m.joinUrl && <> · <a className="link" href={m.joinUrl} target="_blank" rel="noopener noreferrer">link</a></>}</span>
              {manage ? <ActionForm action={A.meetingAction} className="flex gap-1">{hidden}<input type="hidden" name="meetingId" value={m.id} /><select name="status" defaultValue={m.status} aria-label="Meeting status" className="input !py-1 text-[12px]"><option value="scheduled">Scheduled</option><option value="held">Held</option><option value="no_show">No-show</option><option value="cancelled">Cancelled</option></select><Submit className="btn-ghost btn-sm">Save</Submit></ActionForm> : <Badge>{m.status}</Badge>}</div>)}
            {manage && editable && (
              <ActionForm action={A.meetingAction} className="grid grid-cols-2 gap-2 border-t border-line pt-3" resetOnSuccess>{hidden}
                <input name="date" type="date" required aria-label="Date" className="input" /><input name="time" type="time" required aria-label="Time" className="input" />
                <select name="provider" aria-label="Provider" className="input"><option value="google_meet">Google Meet</option><option value="zoom">Zoom</option><option value="teams">Teams</option><option value="whatsapp">WhatsApp video</option><option value="in_person">In person</option></select>
                <input name="joinUrl" placeholder="https://…" aria-label="Meeting link" className="input" />
                <div className="col-span-2"><Submit className="btn-secondary btn-sm">Schedule introduction</Submit><p className="mt-1 text-[12px] text-muted">An invitation is not a held meeting — update the status afterwards.</p></div>
              </ActionForm>
            )}
          </Section>
          {manage && (
            <Section title="Responsibilities (shared with nanny)">
              <ActionForm action={A.responsibilitiesAction} className="space-y-2">{hidden}<textarea name="responsibilities" rows={3} defaultValue={b.responsibilities ?? ""} aria-label="Responsibilities" className="input" placeholder="School runs, swimming lessons, light meal prep…" /><Submit className="btn-secondary btn-sm">Save</Submit></ActionForm>
            </Section>
          )}
          {manage && !["completed", "cancelled", "declined", "refunded", "in_progress"].includes(b.status) && (
            <Section title="Reschedule">
              <ActionForm action={A.rescheduleAction} className="grid grid-cols-2 gap-2">{hidden}
                <input name="startDate" type="date" defaultValue={b.startDate} aria-label="Start date" required className="input" /><input name="endDate" type="date" defaultValue={b.endDate} aria-label="End date" className="input" />
                <input name="startTime" type="time" defaultValue={minutesToHHMM(b.dailyStartMinute)} aria-label="Start time" className="input" /><input name="endTime" type="time" defaultValue={minutesToHHMM(b.dailyEndMinute)} aria-label="End time" className="input" />
                <input name="reason" required placeholder="Reason (shared with family)" aria-label="Reason" className="input col-span-2" />
                <div className="col-span-2"><Submit className="btn-secondary btn-sm">Reschedule</Submit><p className="mt-1 text-[12px] text-muted">Conflicts are checked against the nanny&rsquo;s other bookings. The agreed price is unchanged unless you issue a revised quotation.</p></div>
              </ActionForm>
            </Section>
          )}
          <Section title="Activity">
            {manage && <ActionForm action={A.noteAction} className="mb-5 space-y-2" resetOnSuccess>{hidden}<textarea name="note" rows={2} required aria-label="Note" className="input" placeholder="Add a note…" /><div className="flex items-center justify-between"><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="shared" className="accent-navy" />Visible to family</label><Submit className="btn-secondary btn-sm">Add note</Submit></div></ActionForm>}
            <Timeline events={d.events} showInternal />
          </Section>
        </div>
      </div>
    </>
  );
}
