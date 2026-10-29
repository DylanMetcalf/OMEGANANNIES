import { describe, expect, it } from "vitest";
import { applyBps, formatMoney, mulQty, parseMoney } from "@/lib/money";
import { calculateQuote, PricingError, type PriceItem } from "@/lib/pricing";
import { PRICE_ITEMS_V1 } from "@/db/seed/reference";

const items = PRICE_ITEMS_V1 as PriceItem[];
const base = { audience: "visiting", serviceCode: "holiday", liveIn: false, overnight: false, specialist: false, travelTrips: 0, publicHolidays: new Set<string>() };

describe("money", () => {
  it("uses integer arithmetic with half-up rounding", () => {
    expect(applyBps(10001, 2000)).toBe(2000); // 2000.2 → 2000
    expect(applyBps(10003, 5000)).toBe(5002); // 5001.5 → 5002
    expect(mulQty(30000, 433)).toBe(129900);
    expect(() => applyBps(1.5, 100)).toThrow();
  });
  it("parses and formats rand without floats", () => {
    expect(parseMoney("R1 250.5")).toBe(125050);
    expect(parseMoney("-500")).toBe(-50000);
    expect(() => parseMoney("12.345")).toThrow();
    expect(formatMoney(220000)).toBe("R2 200");
    expect(formatMoney(125050)).toBe("R1 250.50");
  });
});

describe("pricing", () => {
  it("applies the 4-hour minimum for short hourly days", () => {
    const q = calculateQuote(items, { ...base, dates: ["2027-02-01"], dailyStartMinute: 600, dailyEndMinute: 720 });
    expect(q.subtotalMinor).toBe(4 * 30000);
    expect(q.assumptions.join()).toMatch(/Minimum/);
  });
  it("uses the daily rate when cheaper than hourly", () => {
    const q = calculateQuote(items, { ...base, dates: ["2027-02-01", "2027-02-02"], dailyStartMinute: 480, dailyEndMinute: 1080 });
    expect(q.subtotalMinor).toBe(2 * 220000);
  });
  it("charges extra hourly beyond a 10-hour day", () => {
    const q = calculateQuote(items, { ...base, dates: ["2027-02-01"], dailyStartMinute: 420, dailyEndMinute: 1140 }); // 12h
    expect(q.subtotalMinor).toBe(220000 + 2 * 30000);
  });
  it("tiers live-in by stay length", () => {
    const d = (n: number) => Array.from({ length: n }, (_, i) => `2027-03-${String(i + 1).padStart(2, "0")}`);
    const L = { ...base, serviceCode: "live_in", liveIn: true, dailyStartMinute: 480, dailyEndMinute: 480 };
    expect(calculateQuote(items, { ...L, dates: d(3) }).subtotalMinor).toBe(3 * 350000);
    expect(calculateQuote(items, { ...L, dates: d(7) }).subtotalMinor).toBe(1890000);
    expect(calculateQuote(items, { ...L, dates: d(28) }).subtotalMinor).toBe(28 * 225000);
  });
  it("adds specialist, holiday, overnight and travel lines and a deposit", () => {
    const q = calculateQuote(items, { ...base, specialist: true, overnight: true, travelTrips: 2, publicHolidays: new Set(["2026-12-25"]), dates: ["2026-12-25"], dailyStartMinute: 480, dailyEndMinute: 1080 });
    const labels = q.lines.map((l) => l.label).join("|");
    expect(labels).toMatch(/public holiday premium/i);
    expect(labels).toMatch(/Specialist/);
    expect(q.subtotalMinor).toBe(220000 + 110000 + 44000 + 45000 + 50000);
    expect(q.depositMinor).toBe(applyBps(q.subtotalMinor, 3000));
  });
  it("refuses to price unknown configurations rather than guessing", () => {
    expect(() => calculateQuote(items, { ...base, audience: "resident", dates: ["2027-02-01"], dailyStartMinute: 480, dailyEndMinute: 1080 })).toThrow(PricingError);
  });
});
