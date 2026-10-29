/** Time-zone helpers. Bookings store local dates/minutes plus an IANA zone; sessions are stored in UTC. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - at.getTime()) / 60000;
}
export function zonedToUtc(isoDate: string, minuteOfDay: number, zone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minuteOfDay));
  const off = offsetMinutes(zone, guess);
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = offsetMinutes(zone, first); // correct across DST boundaries
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z"), e = new Date(end + "T00:00:00Z");
  if (e < d) return out;
  for (; d <= e && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
export const weekday = (isoDate: string) => new Date(isoDate + "T00:00:00Z").getUTCDay();
export const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error("Invalid time");
  return +m[1] * 60 + +m[2];
}
/** Duration of a daily window in minutes; end <= start means it runs past midnight. */
export const windowMinutes = (start: number, end: number) => (end > start ? end - start : end + 1440 - start);

/** Care dates for a booking: every day in range, or only the chosen weekdays (0=Sun…6=Sat) for recurring patterns. */
export function careDates(b: { startDate: string; endDate: string; weekdays?: number[] | null; liveIn?: boolean }): string[] {
  const all = eachDate(b.startDate, b.endDate);
  return !b.liveIn && b.weekdays?.length ? all.filter((d) => b.weekdays!.includes(weekday(d))) : all;
}
export type Session = { date: string; startsAt: Date; endsAt: Date };
export function buildSessions(b: { startDate: string; endDate: string; dailyStartMinute: number; dailyEndMinute: number; timeZone: string; liveIn?: boolean; weekdays?: number[] | null }): Session[] {
  const dates = careDates(b);
  if (b.liveIn) {
    // Live-in: one continuous block from first day start to last day end.
    const startsAt = zonedToUtc(b.startDate, b.dailyStartMinute, b.timeZone);
    const endsAt = zonedToUtc(b.endDate, b.dailyStartMinute + 1440, b.timeZone);
    return [{ date: b.startDate, startsAt, endsAt }];
  }
  return dates.map((date) => {
    const startsAt = zonedToUtc(date, b.dailyStartMinute, b.timeZone);
    return { date, startsAt, endsAt: new Date(startsAt.getTime() + windowMinutes(b.dailyStartMinute, b.dailyEndMinute) * 60000) };
  });
}
export const fmtDate = (d: Date | string, zone = "Africa/Johannesburg") =>
  new Intl.DateTimeFormat("en-ZA", { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(typeof d === "string" ? new Date(d + (d.length === 10 ? "T12:00:00Z" : "")) : d);
export const fmtDateTime = (d: Date, zone = "Africa/Johannesburg") =>
  new Intl.DateTimeFormat("en-ZA", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
export function ageFrom(dob: string | null, at = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00Z");
  let a = at.getUTCFullYear() - d.getUTCFullYear();
  if (at.getUTCMonth() < d.getUTCMonth() || (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate())) a--;
  return a;
}
export function ageGroup(age: number): string {
  return age < 1 ? "newborn" : age < 3 ? "toddler" : age < 6 ? "preschool" : age < 13 ? "school" : "teen";
}
/** Human age: months for babies, years otherwise. */
export function ageLabel(dob: string | null, at = new Date()): string {
  if (!dob) return "age not given";
  const d = new Date(dob + "T00:00:00Z");
  const months = (at.getUTCFullYear() - d.getUTCFullYear()) * 12 + at.getUTCMonth() - d.getUTCMonth() - (at.getUTCDate() < d.getUTCDate() ? 1 : 0);
  return months < 24 ? `${Math.max(0, months)} months` : `${Math.floor(months / 12)} yrs`;
}
