import { describe, expect, it } from "vitest";
import { hashPassword, totp, verifyPassword, verifyTotp } from "@/lib/crypto";
import { amountToMinor, checkoutFields, parseItn, payfastSignature, verifyItnSignature } from "@/lib/payments/payfast";
import { buildSessions, windowMinutes, zonedToUtc } from "@/lib/time";

describe("passwords & TOTP", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
  it("matches RFC 6238 test vector", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    expect(totp(secret, 59_000)).toBe("287082");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });
});

describe("PayFast", () => {
  it("signs checkout fields in documented order with passphrase", () => {
    const f = checkoutFields({ merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "pass", returnUrl: "https://x/r", cancelUrl: "https://x/c", notifyUrl: "https://x/n", firstName: "Ann", email: "a@b.co", paymentId: "p1", amountMinor: 120050, itemName: "Omega ON-1" });
    expect(f.find(([k]) => k === "amount")![1]).toBe("1200.50");
    const sig = f.pop()!;
    expect(sig[0]).toBe("signature");
    expect(sig[1]).toBe(payfastSignature(f, "pass"));
  });
  it("verifies ITN signatures and rejects tampering", () => {
    const fields: [string, string][] = [["m_payment_id", "p1"], ["pf_payment_id", "123"], ["payment_status", "COMPLETE"], ["amount_gross", "100.00"], ["merchant_id", "10000100"]];
    const body = [...fields, ["signature", payfastSignature(fields, "pp")]].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    expect(verifyItnSignature(parseItn(body), "pp")).toBe(true);
    expect(verifyItnSignature(parseItn(body.replace("100.00", "1.00")), "pp")).toBe(false);
    expect(verifyItnSignature(parseItn(body), "other")).toBe(false);
    expect(amountToMinor("1200.5")).toBe(120050);
  });
});

describe("time", () => {
  it("converts Cape Town local time to UTC", () => {
    expect(zonedToUtc("2027-01-10", 9 * 60, "Africa/Johannesburg").toISOString()).toBe("2027-01-10T07:00:00.000Z");
    expect(zonedToUtc("2027-07-10", 9 * 60, "Europe/London").toISOString()).toBe("2027-07-10T08:00:00.000Z");
  });
  it("builds per-day sessions, overnight windows and live-in blocks", () => {
    expect(windowMinutes(1200, 360)).toBe(600);
    const night = buildSessions({ startDate: "2027-01-10", endDate: "2027-01-11", dailyStartMinute: 1200, dailyEndMinute: 360, timeZone: "Africa/Johannesburg" });
    expect(night).toHaveLength(2);
    expect(night[0].endsAt.toISOString()).toBe("2027-01-11T04:00:00.000Z");
    const live = buildSessions({ startDate: "2027-01-10", endDate: "2027-01-16", dailyStartMinute: 480, dailyEndMinute: 480, timeZone: "Africa/Johannesburg", liveIn: true });
    expect(live).toHaveLength(1);
  });
});
