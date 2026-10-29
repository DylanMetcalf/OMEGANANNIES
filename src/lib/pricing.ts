import { applyBps, mulQty } from "./money";
import { windowMinutes } from "./time";

export type PriceItem = { code: string; audience: string; serviceCode: string | null; unit: string; amount: number; label: string };
export type QuoteLine = { label: string; qty: string; unitMinor: number; totalMinor: number };
export type QuoteInput = {
  audience: string; serviceCode: string; dates: string[]; dailyStartMinute: number; dailyEndMinute: number;
  liveIn: boolean; overnight: boolean; specialist: boolean; travelTrips: number; publicHolidays: Set<string>;
};
export type QuoteResult = { lines: QuoteLine[]; subtotalMinor: number; depositMinor: number; currency: string; assumptions: string[] };

export class PricingError extends Error {}

/** Most specific item wins: exact service match, then the audience-wide default. */
export function pick(items: PriceItem[], code: string, audience: string, serviceCode: string): PriceItem | undefined {
  return items.find((i) => i.code === code && i.audience === audience && i.serviceCode === serviceCode)
    ?? items.find((i) => i.code === code && i.audience === audience && i.serviceCode === null);
}

/**
 * Server-side quotation calculator. All amounts are integer cents; quantities use hundredths.
 * Never trust client-supplied amounts — always call this with the published price book.
 */
export function calculateQuote(items: PriceItem[], q: QuoteInput, currency = "ZAR"): QuoteResult {
  const get = (code: string) => pick(items, code, q.audience, q.serviceCode);
  const need = (code: string) => { const i = get(code); if (!i) throw new PricingError(`No ${code} price configured for ${q.audience}/${q.serviceCode}. Prepare a bespoke quotation.`); return i; };
  if (!q.dates.length) throw new PricingError("Booking has no dates");
  const lines: QuoteLine[] = [];
  const assumptions: string[] = [];
  const careLines: QuoteLine[] = [];

  if (q.liveIn) {
    const days = q.dates.length;
    let perDay: number, label: string;
    if (days >= 28 && get("livein_monthly")) { perDay = need("livein_monthly").amount; label = "Live-in care (monthly rate, per day)"; }
    else if (days >= 7 && get("livein_weekly")) { perDay = Math.round(need("livein_weekly").amount / 7); label = "Live-in care (weekly rate, per day)"; }
    else { perDay = need("livein_daily").amount; label = "Live-in care (per day)"; }
    careLines.push({ label, qty: `${days} days`, unitMinor: perDay, totalMinor: perDay * days });
  } else {
    const minutes = windowMinutes(q.dailyStartMinute, q.dailyEndMinute);
    const hoursH = Math.round((minutes * 100) / 60); // hundredths of an hour
    const hourly = need("hourly").amount;
    const minH = (get("min_hours")?.amount ?? 0) * 100;
    const daily = get("daily"); const dayH = (get("day_hours")?.amount ?? 10) * 100;
    const hourlyCost = mulQty(hourly, Math.max(hoursH, minH));
    const dailyCost = daily ? daily.amount + mulQty(hourly, Math.max(0, hoursH - dayH)) : Infinity;
    const useDaily = dailyCost <= hourlyCost;
    const perSession = useDaily ? dailyCost : hourlyCost;
    if (hoursH < minH) assumptions.push(`Minimum booking of ${minH / 100} hours applied per day.`);
    if (useDaily && daily) assumptions.push(`Daily rate (${dayH / 100}-hour day) applied as it is lower than the hourly total.`);
    for (const date of q.dates) {
      const isHoliday = q.publicHolidays.has(date);
      careLines.push({ label: `${useDaily ? "Daily care" : "Hourly care"} — ${date}${isHoliday ? " (public holiday)" : ""}`, qty: useDaily ? "1 day" : `${(Math.max(hoursH, minH) / 100).toFixed(2)} h`, unitMinor: useDaily ? perSession : hourly, totalMinor: perSession });
    }
  }
  lines.push(...careLines);
  const careSubtotal = careLines.reduce((s, l) => s + l.totalMinor, 0);

  const holidayPremium = get("public_holiday_premium");
  if (holidayPremium) {
    const holidayCare = careLines.filter((l) => l.label.includes("(public holiday)")).reduce((s, l) => s + l.totalMinor, 0);
    if (holidayCare) lines.push({ label: `Public holiday premium (${holidayPremium.amount / 100}%)`, qty: "1", unitMinor: applyBps(holidayCare, holidayPremium.amount), totalMinor: applyBps(holidayCare, holidayPremium.amount) });
  } else if (q.dates.some((d) => q.publicHolidays.has(d))) assumptions.push("Booking includes a public holiday but no holiday premium is configured.");

  if (q.specialist) {
    const p = need("specialist_premium");
    const amt = applyBps(careSubtotal, p.amount);
    lines.push({ label: `${p.label} (${p.amount / 100}%)`, qty: "1", unitMinor: amt, totalMinor: amt });
  }
  if (q.overnight && !q.liveIn) {
    const f = need("overnight_fee");
    lines.push({ label: f.label, qty: `${q.dates.length} nights`, unitMinor: f.amount, totalMinor: f.amount * q.dates.length });
  }
  if (q.travelTrips > 0) {
    const f = need("travel_fee");
    lines.push({ label: f.label, qty: `${q.travelTrips} trips`, unitMinor: f.amount, totalMinor: f.amount * q.travelTrips });
  }
  const subtotalMinor = lines.reduce((s, l) => s + l.totalMinor, 0);
  const dep = get("deposit");
  const depositMinor = dep ? applyBps(subtotalMinor, dep.amount) : subtotalMinor;
  if (!dep) assumptions.push("No deposit rule configured: full amount payable to confirm.");
  return { lines, subtotalMinor, depositMinor, currency, assumptions };
}
