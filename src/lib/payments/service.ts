import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "../audit";
import { env } from "../env";
import { formatMoney } from "../money";
import { notifyMany } from "../notify";
import { can } from "../permissions";
import { DomainError, onBookingConfirmed, transitionTx } from "../bookings";
import { checkoutFields, payfastHost } from "./payfast";
import type { CurrentUser } from "../auth";

export type ProviderStatus = "succeeded" | "failed" | "cancelled" | "pending";
export type VerifiedEvent = { provider: string; eventId: string; paymentId: string; status: ProviderStatus; amountMinor: number; payload: unknown; providerRef?: string };

export function paymentProvider(): "payfast" | "demo" | null {
  if (env.demo) return "demo";
  return env.payfast.merchantId && env.payfast.merchantKey ? "payfast" : null;
}

/** Create a payment attempt for an invoice. Amount is always taken from the server-side invoice. */
export async function startPayment(u: CurrentUser, invoiceId: string) {
  const provider = paymentProvider();
  if (!provider) throw new DomainError("Online payment is not yet activated. Omega Nannies will send EFT details with your quotation.");
  const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, invoiceId));
  if (!inv) throw new DomainError("Invoice not found");
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, inv.bookingId));
  const [m] = await db.select().from(s.familyMembers).where(and(eq(s.familyMembers.userId, u.id), eq(s.familyMembers.familyId, b.familyId!)));
  if (!m?.canPay) throw new DomainError("Invoice not found");
  if (inv.status !== "open") throw new DomainError("This invoice is not payable.");
  if (inv.kind === "balance" && b.status === "awaiting_payment") throw new DomainError("Please pay the deposit first.");
  if (!["awaiting_payment", "confirmed", "in_progress", "completed"].includes(b.status)) throw new DomainError("This booking is not awaiting payment.");
  const due = inv.amountMinor - inv.paidMinor;
  const [p] = await db.insert(s.payments).values({ invoiceId: inv.id, provider, amountMinor: due, currency: inv.currency, status: "initiated", initiatedBy: u.id }).returning();
  await db.update(s.payments).set({ providerRef: p.id }).where(eq(s.payments.id, p.id));
  await audit(u.id, "payment.initiate", "payment", p.id, { invoice: inv.number, amountMinor: due, provider });
  return { paymentId: p.id, provider };
}

/** PayFast checkout fields recomputed server-side for an initiated payment (never from client input). */
export async function payfastCheckout(u: CurrentUser, paymentId: string) {
  const [p] = await db.select().from(s.payments).where(and(eq(s.payments.id, paymentId), eq(s.payments.initiatedBy, u.id), eq(s.payments.provider, "payfast")));
  if (!p || p.status !== "initiated") return null;
  const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, p.invoiceId));
  const pf = env.payfast;
  return { action: `${payfastHost(pf.sandbox)}/eng/process`, fields: checkoutFields({ merchantId: pf.merchantId, merchantKey: pf.merchantKey, passphrase: pf.passphrase, returnUrl: `${env.appUrl}/pay/${p.id}?return=1`, cancelUrl: `${env.appUrl}/pay/${p.id}?cancelled=1`, notifyUrl: `${env.appUrl}/api/payments/payfast/notify`, firstName: u.name.split(" ")[0], email: u.email, paymentId: p.id, amountMinor: p.amountMinor, itemName: `Omega Nannies ${inv.number}` }) };
}

/**
 * Apply a provider-verified payment event exactly once. Safe against replays (unique event id),
 * out-of-order delivery (terminal states never regress) and amount tampering (must equal the attempt).
 */
export async function applyPaymentEvent(e: VerifiedEvent): Promise<string> {
  return db.transaction(async (tx) => {
    const ins = await tx.insert(s.paymentEvents).values({ provider: e.provider, eventId: e.eventId, paymentId: null, signatureValid: true, payload: e.payload as object, outcome: "processing" }).onConflictDoNothing().returning();
    if (!ins.length) return "duplicate";
    const ev = ins[0];
    const setOutcome = async (outcome: string) => { await tx.update(s.paymentEvents).set({ outcome }).where(eq(s.paymentEvents.id, ev.id)); return outcome; };
    const locked = await tx.execute(sql`SELECT id FROM payments WHERE id = ${e.paymentId} AND provider = ${e.provider} FOR UPDATE`);
    if (!locked.rows.length) return setOutcome("unknown_payment");
    const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, e.paymentId));
    await tx.update(s.paymentEvents).set({ paymentId: p.id }).where(eq(s.paymentEvents.id, ev.id));
    if (p.status === "succeeded") return setOutcome("already_applied");
    if (e.status !== "succeeded") {
      if (e.status === "pending") { await tx.update(s.payments).set({ status: "pending", updatedAt: new Date() }).where(eq(s.payments.id, p.id)); return setOutcome("pending"); }
      await tx.update(s.payments).set({ status: e.status, failureReason: `Provider reported ${e.status}`, updatedAt: new Date() }).where(eq(s.payments.id, p.id));
      return setOutcome(e.status);
    }
    if (e.amountMinor !== p.amountMinor) {
      await tx.update(s.payments).set({ status: "failed", failureReason: `Amount mismatch: expected ${p.amountMinor}, got ${e.amountMinor}`, updatedAt: new Date() }).where(eq(s.payments.id, p.id));
      await audit(null, "payment.amount_mismatch", "payment", p.id, { expected: p.amountMinor, got: e.amountMinor }, tx);
      return setOutcome("amount_mismatch");
    }
    await tx.update(s.payments).set({ status: "succeeded", confirmedAt: new Date(), updatedAt: new Date(), ...(e.providerRef ? { failureReason: null } : {}) }).where(eq(s.payments.id, p.id));
    const [inv] = await tx.update(s.invoices).set({ paidMinor: sql`${s.invoices.paidMinor} + ${p.amountMinor}`, status: sql`CASE WHEN ${s.invoices.paidMinor} + ${p.amountMinor} >= ${s.invoices.amountMinor} THEN 'paid' ELSE 'open' END` }).where(eq(s.invoices.id, p.invoiceId)).returning();
    const [b] = await tx.select().from(s.bookings).where(eq(s.bookings.id, inv.bookingId));
    await tx.insert(s.bookingEvents).values({ bookingId: b.id, kind: "payment", note: `${formatMoney(p.amountMinor, p.currency)} received (${inv.kind}, ${e.provider})`, actorId: null });
    await audit(null, "payment.succeeded", "payment", p.id, { invoice: inv.number, amountMinor: p.amountMinor, provider: e.provider }, tx);
    const fam = (await tx.select({ id: s.familyMembers.userId }).from(s.familyMembers).where(eq(s.familyMembers.familyId, b.familyId!))).map((r) => r.id);
    if (inv.status === "paid" && ["deposit", "full"].includes(inv.kind) && b.status === "awaiting_payment") {
      try {
        const nb = await transitionTx(tx, b.id, "confirmed", null, "Confirmed on verified payment");
        await onBookingConfirmed(tx, nb);
      } catch (err) {
        // Payment is recorded; booking stays awaiting payment and is flagged for management (refund or reassign).
        await tx.insert(s.bookingEvents).values({ bookingId: b.id, kind: "note", note: `Payment received but confirmation failed: ${(err as Error).message}`, internal: true });
        return setOutcome("paid_confirmation_failed");
      }
    }
    await notifyMany(fam, "payment_received", { ref: b.reference, amount: formatMoney(p.amountMinor, p.currency) }, `payment:${p.id}:succeeded`, `/family/bookings/${b.id}`, tx);
    return setOutcome("applied");
  });
}

/** Management records an offline (EFT) payment. Audited; goes through the same idempotent path. */
export async function recordManualPayment(u: CurrentUser, invoiceId: string, reference: string) {
  if (!can(u, "payments.manage")) throw new DomainError("You don't have permission to record payments.");
  if (!reference.trim()) throw new DomainError("Enter the bank reference.");
  const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, invoiceId));
  if (!inv || inv.status !== "open") throw new DomainError("Invoice is not open.");
  const due = inv.amountMinor - inv.paidMinor;
  const [p] = await db.insert(s.payments).values({ invoiceId, provider: "manual", providerRef: reference.trim(), amountMinor: due, currency: inv.currency, initiatedBy: u.id }).returning();
  await audit(u.id, "payment.manual_record", "payment", p.id, { reference, amountMinor: due });
  return applyPaymentEvent({ provider: "manual", eventId: `manual:${p.id}`, paymentId: p.id, status: "succeeded", amountMinor: due, payload: { reference, by: u.id } });
}

export async function requestRefund(u: CurrentUser, paymentId: string, amountMinor: number, reason: string) {
  if (!can(u, "payments.manage")) throw new DomainError("You don't have permission to manage refunds.");
  const [p] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
  if (!p || p.status !== "succeeded") throw new DomainError("Only successful payments can be refunded.");
  const [{ refunded }] = await db.select({ refunded: sql<number>`coalesce(sum(${s.refunds.amountMinor}),0)::int` }).from(s.refunds).where(and(eq(s.refunds.paymentId, p.id), sql`${s.refunds.status} <> 'rejected'`));
  if (amountMinor <= 0 || amountMinor + refunded > p.amountMinor) throw new DomainError("Refund exceeds the amount paid.");
  const [r] = await db.insert(s.refunds).values({ paymentId: p.id, amountMinor, reason, requestedBy: u.id }).returning();
  await audit(u.id, "refund.request", "refund", r.id, { paymentId, amountMinor, reason });
  return r;
}
