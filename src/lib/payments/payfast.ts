import { createHash } from "node:crypto";

/** PayFast encoding: urlencode with spaces as '+', uppercase hex escapes. */
const enc = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, "+").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function payfastSignature(fields: [string, string][], passphrase?: string): string {
  let str = fields.filter(([k, v]) => k !== "signature" && v !== "").map(([k, v]) => `${k}=${enc(v)}`).join("&");
  if (passphrase) str += `&passphrase=${enc(passphrase)}`;
  return createHash("md5").update(str).digest("hex");
}

/** Field order matters for PayFast checkout signatures. */
export const CHECKOUT_ORDER = ["merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "name_first", "name_last", "email_address", "m_payment_id", "amount", "item_name", "item_description"];

export function checkoutFields(o: { merchantId: string; merchantKey: string; passphrase: string; returnUrl: string; cancelUrl: string; notifyUrl: string; firstName: string; email: string; paymentId: string; amountMinor: number; itemName: string }) {
  const map: Record<string, string> = {
    merchant_id: o.merchantId, merchant_key: o.merchantKey, return_url: o.returnUrl, cancel_url: o.cancelUrl, notify_url: o.notifyUrl,
    name_first: o.firstName, name_last: "", email_address: o.email, m_payment_id: o.paymentId,
    amount: (o.amountMinor / 100).toFixed(2), item_name: o.itemName.slice(0, 100), item_description: "",
  };
  const fields = CHECKOUT_ORDER.map((k) => [k, map[k]] as [string, string]).filter(([, v]) => v !== "");
  return [...fields, ["signature", payfastSignature(fields, o.passphrase)]] as [string, string][];
}
export const payfastHost = (sandbox: boolean) => (sandbox ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za");

/** Parse an ITN body preserving parameter order (required to recompute the signature). */
export function parseItn(body: string): [string, string][] {
  return body.split("&").filter(Boolean).map((p) => { const [k, v = ""] = p.split("="); return [decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " "))]; });
}
export function verifyItnSignature(fields: [string, string][], passphrase?: string): boolean {
  const sig = fields.find(([k]) => k === "signature")?.[1];
  return !!sig && payfastSignature(fields.filter(([k]) => k !== "signature"), passphrase) === sig;
}
/** Server-to-server confirmation with PayFast that the ITN is genuine. */
export async function validateWithPayfast(rawBody: string, sandbox: boolean): Promise<boolean> {
  const body = rawBody.replace(/&?signature=[^&]*/, "");
  const r = await fetch(`${payfastHost(sandbox)}/eng/query/validate`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return (await r.text()).trim() === "VALID";
}
/** PayFast amounts are decimal strings — convert without floats. */
export function amountToMinor(s: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error("bad amount");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
