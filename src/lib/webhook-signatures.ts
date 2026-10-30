import { createHmac, timingSafeEqual } from "node:crypto";

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Twilio: base64(HMAC-SHA1(authToken, url + concatenated sorted POST params)) in X-Twilio-Signature. */
export function verifyTwilio(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return eq(createHmac("sha1", authToken).update(data, "utf8").digest("base64"), signature);
}

/** Svix (used by Resend): HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_"; 5-minute tolerance. */
export function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest("base64");
  return headers.signature.split(" ").some((part) => { const [v, sig] = part.split(","); return v === "v1" && !!sig && eq(sig, expected); });
}
