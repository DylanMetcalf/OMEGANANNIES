import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { BookingFacts, InvoiceRows, Journey, QuoteTable, Timeline } from "@/components/booking/parts";
import { Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canTransition } from "@/lib/booking-state";
import { bookingAccess } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";
import { bookingDetail } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import type { QuoteLine } from "@/lib/pricing";
import { acceptQuoteAction, cancelBookingAction, payInvoiceAction, submitReviewAction } from "../../actions";

export const metadata = { title: "Booking" };
export default async function FamilyBooking({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const u = await requireUser({ role: "family" });
  const d = await bookingDetail((await params).id);
  if (!d || (await bookingAccess(u, d.b)).level !== "family") notFound();
  const { b } = d;
  const sentQuote = d.quotes.find((q) => q.status === "sent");
  const accepted = d.quotes.find((q) => q.status === "accepted");
  const canCancel = canTransition(b.status, "cancelled", "family");
  return (
    <>
      {d.share && <AutoRefresh seconds={20} />}
      <PageHeader eyebrow={`Booking ${b.reference}`} title={d.serviceName} description={<StatusBadge status={b.status} />}
        actions={<>{d.conversation && <Link href={`/messages/${d.conversation.id}`} className="btn-secondary">Message nanny</Link>}{["completed", "cancelled", "confirmed"].includes(b.status) && <Link href={`/family/bookings/new?repeat=${b.id}`} className="btn-secondary">Book again</Link>}</>} />
      {(await searchParams).new && <div className="mb-6"><Notice tone="ok" title="Request received">Thank you — this is a request, not yet a confirmed booking. We&rsquo;ll be in touch within 4 hours.</Notice></div>}
      <div className="card mb-6 p-5"><Journey status={b.status} /></div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {sentQuote && b.status === "awaiting_approval" && (
            <Section title={`Your quotation (v${sentQuote.version})`} className="border-gold/50">
              <QuoteTable lines={sentQuote.lines as QuoteLine[]} total={sentQuote.totalMinor} deposit={sentQuote.depositMinor} adjustment={sentQuote.adjustmentMinor} adjustmentReason={sentQuote.adjustmentReason} currency={sentQuote.currency} />
              <p className="mt-3 text-[13px] text-muted">Valid until {sentQuote.validUntil && fmtDateTime(sentQuote.validUntil)}. Travel, public holiday and overnight fees are included above where they apply.</p>
              <ActionForm action={acceptQuoteAction} className="mt-4 space-y-3">
                <input type="hidden" name="quotationId" value={sentQuote.id} />
                <label className="flex gap-2.5 text-[14px]"><input type="checkbox" name="terms" required className="mt-1 accent-navy" /><span>I accept this quotation and the booking and cancellation terms. I understand the booking is confirmed only once the deposit of <strong>{formatMoney(sentQuote.depositMinor)}</strong> is received.</span></label>
                <Submit className="btn-gold" pendingText="Accepting…">Accept quotation</Submit>
              </ActionForm>
            </Section>
          )}
          {d.invoices.length > 0 && (
            <Section title="Payments">
              {b.status === "awaiting_payment" && <div className="mb-4"><Notice tone="warn">Your nanny&rsquo;s dates are held. Pay the deposit to confirm — confirmation happens automatically once our payment provider verifies it.</Notice></div>}
              <InvoiceRows invoices={d.invoices} payments={d.payments} action={(inv) => inv.status === "open" && !(inv.kind === "balance" && b.status === "awaiting_payment") && ["awaiting_payment", "confirmed", "in_progress", "completed"].includes(b.status) ? (
                <ActionForm action={payInvoiceAction}><input type="hidden" name="invoiceId" value={inv.id} /><Submit className="btn-primary btn-sm" pendingText="Opening…">Pay {formatMoney(inv.amountMinor - inv.paidMinor)}</Submit></ActionForm>
              ) : null} />
            </Section>
          )}
          <Section title="Booking details"><BookingFacts d={d} showPreciseLocation /></Section>
          {d.meetings.length > 0 && (
            <Section title="Introductions">
              <ul className="space-y-3">{d.meetings.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]"><span>{fmtDateTime(m.startsAt)} · {m.provider.replace("_", " ")} · <span className="capitalize">{m.status}</span></span>{m.joinUrl && m.status !== "cancelled" && <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">Join call</a>}</li>)}</ul>
            </Section>
          )}
          {d.share && (
            <Section title="Live location (shared by your nanny)">
              <p className="text-[14px]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-ok" />Sharing until {fmtDateTime(d.share.expiresAt)}</p>
              {d.share.lat ? <p className="mt-2 text-[14px]">Last updated {d.share.pointAt && fmtDateTime(d.share.pointAt)} (±{d.share.accuracyM} m) · <a className="link" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${d.share.lat}&mlon=${d.share.lng}#map=16/${d.share.lat}/${d.share.lng}`}>Open map</a></p> : <p className="mt-2 text-[14px] text-muted">Waiting for first location…</p>}
              {d.share.checkInNote && <p className="mt-2 text-[14px]">Check-in: {d.share.checkInNote}</p>}
            </Section>
          )}
          {b.status === "completed" && (
            <Section title="Your review" className="scroll-mt-6">
              <div id="review" />
              {d.review ? <p className="text-[14px]">{"★".repeat(d.review.rating)} — {d.review.body} <span className="block text-[12px] text-muted">Status: {d.review.status}</span></p> : (
                <ActionForm action={submitReviewAction} className="space-y-3">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <fieldset><legend className="label">Rating</legend><div className="flex gap-3">{[5, 4, 3, 2, 1].map((r) => <label key={r} className="flex items-center gap-1 text-[14px]"><input type="radio" name="rating" value={r} required className="accent-gold" />{"★".repeat(r)}</label>)}</div></fieldset>
                  <div><label className="label" htmlFor="body">Your experience</label><textarea id="body" name="body" rows={4} required minLength={10} maxLength={2000} className="input" /><p className="mt-1 text-[12px] text-muted">Please don&rsquo;t include children&rsquo;s full names or private details. Concerns? <Link href="/messages" className="link">Message us privately</Link> instead.</p></div>
                  <Submit>Submit review</Submit>
                </ActionForm>
              )}
            </Section>
          )}
        </div>
        <div className="space-y-6">
          {accepted && <Section title="Agreed price"><p className="font-display text-[32px] text-navy">{formatMoney(accepted.totalMinor)}</p><p className="text-[13px] text-muted">Quotation v{accepted.version}, accepted {accepted.acceptedAt && fmtDateTime(accepted.acceptedAt)}. This price won&rsquo;t change without your agreement.</p></Section>}
          <Section title="History"><Timeline events={d.events} showInternal={false} /></Section>
          {canCancel && (
            <Section title="Cancel">
              <ActionForm action={cancelBookingAction} confirm="Cancel this booking?" className="space-y-3">
                <input type="hidden" name="bookingId" value={b.id} />
                <label className="label" htmlFor="reason">Reason (optional)</label><textarea id="reason" name="reason" rows={2} className="input" />
                {b.status === "confirmed" && <p className="text-[12px] text-muted">Cancellation fees may apply under your quotation terms. Our team will confirm any refund.</p>}
                <Submit className="btn-danger" pendingText="Cancelling…">Cancel booking</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
