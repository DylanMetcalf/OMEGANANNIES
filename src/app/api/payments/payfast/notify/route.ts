import { env } from "@/lib/env";
import { amountToMinor, parseItn, validateWithPayfast, verifyItnSignature } from "@/lib/payments/payfast";
import { applyPaymentEvent } from "@/lib/payments/service";
import { db, schema as s } from "@/db";
import { deliverPending } from "@/lib/notify";

/**
 * PayFast ITN endpoint. A payment is applied only when: the signature verifies with our passphrase, the merchant id
 * matches, PayFast's validate endpoint confirms the notification, and the amount equals the server-side attempt.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const fields = parseItn(raw);
  const get = (k: string) => fields.find(([x]) => x === k)?.[1] ?? "";
  const eventId = get("pf_payment_id") ? `${get("pf_payment_id")}:${get("payment_status")}` : "";
  const sigOk = verifyItnSignature(fields, env.payfast.passphrase || undefined);
  if (!sigOk || get("merchant_id") !== env.payfast.merchantId || !eventId) {
    await db.insert(s.paymentEvents).values({ provider: "payfast", eventId: `rejected:${Date.now()}:${Math.random()}`, signatureValid: false, payload: { reason: !sigOk ? "bad_signature" : "bad_merchant", m_payment_id: get("m_payment_id") }, outcome: "rejected" });
    return new Response("invalid", { status: 400 });
  }
  if (!(await validateWithPayfast(raw, env.payfast.sandbox).catch(() => false))) return new Response("unverified", { status: 400 });
  const status = get("payment_status") === "COMPLETE" ? "succeeded" : get("payment_status") === "CANCELLED" ? "cancelled" : get("payment_status") === "FAILED" ? "failed" : "pending";
  const payload = Object.fromEntries(fields.filter(([k]) => !["signature", "email_address", "name_first", "name_last"].includes(k)));
  const outcome = await applyPaymentEvent({ provider: "payfast", eventId, paymentId: get("m_payment_id"), status, amountMinor: amountToMinor(get("amount_gross")), payload, providerRef: get("pf_payment_id") });
  void deliverPending();
  return new Response(outcome, { status: 200 });
}
