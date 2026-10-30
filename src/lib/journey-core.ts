/**
 * Booking journey: pure, framework-free logic (unit-tested). Server code lives in journey.ts.
 * Requirements travel in the URL (so back/forward and sharing between steps keep context) and are mirrored
 * to a server-side draft so a family can continue on another device.
 */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const; // index → JS weekday (i+1)%7
export const AGE_GROUPS: [string, string][] = [["newborn", "Newborn"], ["toddler", "Toddler"], ["preschool", "Pre-school"], ["school", "School age"], ["teen", "Teen"]];

export type Req = {
  service: string; start: string; end: string; recurring: boolean; weekdays: number[]; t1: string; t2: string;
  area: string; kids: string[]; ages: string[]; langs: string[]; driver: boolean; specialist: boolean; minExp: number; notes: string;
};
export const EMPTY_REQ: Req = { service: "", start: "", end: "", recurring: false, weekdays: [], t1: "09:00", t2: "17:00", area: "", kids: [], ages: [], langs: [], driver: false, specialist: false, minExp: 0, notes: "" };

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",") : []).map((x) => x.trim()).filter(Boolean);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lenient parse of URL params or a stored draft: unknown or malformed values are dropped, never trusted. */
export function parseReq(src: Record<string, unknown>): Req {
  const g = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : Array.isArray(src[k]) ? String((src[k] as unknown[])[0] ?? "") : "");
  const start = isDate(g("start")) ? g("start") : "";
  const end = isDate(g("end")) && g("end") >= start ? g("end") : "";
  return {
    service: /^[a-z_]{2,40}$/.test(g("service")) ? g("service") : "",
    start, end,
    recurring: g("recurring") === "1",
    weekdays: [...new Set(list(src.weekdays).map(Number).filter((w) => Number.isInteger(w) && w >= 0 && w <= 6))].sort(),
    t1: isTime(g("t1")) ? g("t1") : "09:00",
    t2: isTime(g("t2")) ? g("t2") : "17:00",
    area: g("area").slice(0, 80),
    kids: list(src.kids).filter((k) => uuid.test(k)).slice(0, 10),
    ages: list(src.ages).filter((a) => AGE_GROUPS.some(([k]) => k === a)),
    langs: list(src.langs).filter((l) => /^[A-Za-z -]{2,30}$/.test(l)).slice(0, 6),
    driver: g("driver") === "1",
    specialist: g("specialist") === "1",
    minExp: Math.max(0, Math.min(30, Number.parseInt(g("minExp"), 10) || 0)),
    notes: g("notes").slice(0, 2000),
  };
}

/** Requirements → query string (notes stay out of URLs; they live in the draft only). */
export function reqToParams(r: Req): URLSearchParams {
  const p = new URLSearchParams();
  if (r.service) p.set("service", r.service);
  if (r.start) p.set("start", r.start);
  if (r.end && r.end !== r.start) p.set("end", r.end);
  if (r.recurring) { p.set("recurring", "1"); if (r.weekdays.length) p.set("weekdays", r.weekdays.join(",")); }
  if (r.service !== "live_in") { p.set("t1", r.t1); p.set("t2", r.t2); }
  if (r.area) p.set("area", r.area);
  if (r.kids.length) p.set("kids", r.kids.join(","));
  if (r.ages.length) p.set("ages", r.ages.join(","));
  if (r.langs.length) p.set("langs", r.langs.join(","));
  if (r.driver) p.set("driver", "1");
  if (r.specialist) p.set("specialist", "1");
  if (r.minExp) p.set("minExp", String(r.minExp));
  return p;
}

export type ReqErrors = Partial<Record<keyof Req, string>>;
/** Step-1 validation. Messages are written for families, not developers. */
export function validateReq(r: Req, today: string, hasKids: boolean): ReqErrors {
  const e: ReqErrors = {};
  if (!r.service) e.service = "Choose the type of care you need.";
  if (!r.start) e.start = "Choose a start date.";
  else if (r.start < today) e.start = "The start date has already passed.";
  if (r.end && r.end < r.start) e.end = "The end date must be on or after the start date.";
  if (r.recurring && !r.end) e.end = "Choose until when the care repeats.";
  if (r.recurring && !r.weekdays.length) e.weekdays = "Choose at least one day of the week.";
  if (r.start && r.end) {
    const days = (Date.parse(r.end) - Date.parse(r.start)) / 86400_000 + 1;
    if (days > 120) e.end = "For more than 120 days, please message us for a bespoke arrangement.";
  }
  if (r.service !== "live_in" && r.t1 === r.t2) e.t2 = "Start and finish times can't be the same.";
  if (!r.area) e.area = "Choose where care is needed (an area is enough for now).";
  if (hasKids && !r.kids.length) e.kids = "Choose who the care is for.";
  if (!hasKids && !r.ages.length) e.ages = "Choose your children's age groups.";
  return e;
}

// ---------- Discovery ----------
export type Filters = { q: string; area: string; lang: string; minExp: number; age: string; skill: string; drives: boolean; rating: number; avail: boolean; sort: "match" | "experience" | "rating" | "name"; page: number };
export function parseFilters(src: Record<string, unknown>): Filters {
  const g = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : "");
  const sort = g("sort");
  return {
    q: g("q").slice(0, 80), area: g("farea").slice(0, 80), lang: g("flang").slice(0, 30), minExp: Math.max(0, Math.min(30, Number.parseInt(g("fexp"), 10) || 0)),
    age: AGE_GROUPS.some(([k]) => k === g("fage")) ? g("fage") : "", skill: g("fskill").slice(0, 60), drives: g("fdrive") === "1",
    rating: g("frating") === "4" ? 4 : 0, avail: g("favail") === "1",
    sort: (["match", "experience", "rating", "name"] as const).find((x) => x === sort) ?? "match",
    page: Math.max(1, Math.min(50, Number.parseInt(g("page"), 10) || 1)),
  };
}
export const FILTER_KEYS = ["q", "farea", "flang", "fexp", "fage", "fskill", "fdrive", "frating", "favail", "sort"] as const;

export type Availability = "available" | "partial" | "unavailable" | null;
export type DiscoverNanny = {
  id: string; displayName: string; headline: string | null; bio: string | null; yearsExperience: number; languages: string[]; areas: string[];
  skills: string[]; ageGroups: string[]; services: string[]; canDrive: boolean; specialistExperience: string | null;
};
export type Scored<N> = N & { availability: Availability; rating: { avg: number; n: number } | null; reasons: string[]; score: number };

const lc = (x: string) => x.toLowerCase();
/**
 * Requirements are hard filters only where the family made them a must (service, required languages, driving,
 * minimum experience). Everything else ranks and explains. Ratings shown only from published reviews.
 */
export function filterAndSort<N extends DiscoverNanny>(all: N[], req: Req, f: Filters, avail: Record<string, Availability>, ratings: Record<string, { avg: number; n: number }>): Scored<N>[] {
  const q = lc(f.q.trim());
  const minExp = Math.max(req.minExp, f.minExp);
  const out: Scored<N>[] = [];
  for (const n of all) {
    if (req.service && !n.services.includes(req.service)) continue;
    if (req.langs.some((l) => !n.languages.map(lc).includes(lc(l)))) continue;
    if ((req.driver || f.drives) && !n.canDrive) continue;
    if (n.yearsExperience < minExp) continue;
    if (q && ![n.displayName, n.headline ?? "", n.bio ?? "", n.skills.join(" ")].some((t) => lc(t).includes(q))) continue;
    if (f.area && !n.areas.map(lc).includes(lc(f.area))) continue;
    if (f.lang && !n.languages.map(lc).includes(lc(f.lang))) continue;
    if (f.age && !n.ageGroups.includes(f.age)) continue;
    if (f.skill && !n.skills.some((s) => lc(s).includes(lc(f.skill)))) continue;
    const rating = ratings[n.id] ?? null;
    if (f.rating && (!rating || rating.avg < f.rating)) continue;
    const a = avail[n.id] ?? null;
    if (f.avail && a === "unavailable") continue;
    const reasons: string[] = [];
    let score = 0;
    if (a === "available") { score += 30; reasons.push("Free on your dates"); } else if (a === "partial") { score += 10; reasons.push("Free on some of your dates"); }
    if (req.area && n.areas.map(lc).includes(lc(req.area))) { score += 20; reasons.push(`Covers ${req.area}`); }
    const ages = req.ages.filter((x) => n.ageGroups.includes(x));
    if (req.ages.length && ages.length === req.ages.length) { score += 15; reasons.push(`Experienced with ${ages.map((x) => AGE_GROUPS.find(([k]) => k === x)?.[1].toLowerCase()).join(" & ")}`); }
    if (req.specialist && n.specialistExperience) { score += 10; reasons.push("Additional-needs experience"); }
    score += Math.min(15, n.yearsExperience) + (rating ? rating.avg * 2 : 0);
    out.push({ ...n, availability: a, rating, reasons, score });
  }
  const by = {
    match: (x: Scored<N>, y: Scored<N>) => y.score - x.score,
    experience: (x: Scored<N>, y: Scored<N>) => y.yearsExperience - x.yearsExperience,
    rating: (x: Scored<N>, y: Scored<N>) => (y.rating?.avg ?? 0) - (x.rating?.avg ?? 0) || (y.rating?.n ?? 0) - (x.rating?.n ?? 0),
    name: (x: Scored<N>, y: Scored<N>) => x.displayName.localeCompare(y.displayName),
  }[f.sort];
  return out.sort((x, y) => by(x, y) || x.displayName.localeCompare(y.displayName));
}
export const PAGE_SIZE = 12;
export const paginate = <T,>(xs: T[], page: number) => ({ items: xs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), pages: Math.max(1, Math.ceil(xs.length / PAGE_SIZE)) });

/** Availability across the requested care sessions: free on all, some, or none. */
export function classify(sessions: { startsAt: Date; endsAt: Date }[], busy: { startsAt: Date; endsAt: Date }[]): Availability {
  if (!sessions.length) return null;
  const clash = sessions.filter((s) => busy.some((b) => b.startsAt < s.endsAt && b.endsAt > s.startsAt)).length;
  return clash === 0 ? "available" : clash === sessions.length ? "unavailable" : "partial";
}

/** Keep the family's order for nannies still on the shortlist, append new ones, cap at three preferences. */
export function orderPreferences(prefs: string[], shortlist: string[], max = 3): string[] {
  const keep = prefs.filter((p, i) => shortlist.includes(p) && prefs.indexOf(p) === i);
  return keep.slice(0, max);
}
/** Ratings: show an average only from 3+ published reviews; fewer shows the count alone. */
export const showAverage = (r: { avg: number; n: number } | null) => !!r && r.n >= 3;

/** Comparison rows for 2–4 nannies: public, relevant facts only. */
export function compareRows(n: DiscoverNanny & { availability: Availability; rating: { avg: number; n: number } | null }, svc: Record<string, string>): [string, string][] {
  const avail = { available: "Free on your dates", partial: "Free on some dates", unavailable: "Not free on your dates" } as const;
  return [
    ["Experience", `${n.yearsExperience} years`],
    ["Availability", n.availability ? avail[n.availability] : "Add dates to check"],
    ["Reviews", n.rating ? (showAverage(n.rating) ? `★ ${n.rating.avg} from ${n.rating.n}` : `${n.rating.n} review${n.rating.n === 1 ? "" : "s"}`) : "No reviews yet"],
    ["Services", n.services.map((s) => svc[s] ?? s).join(", ")],
    ["Ages", n.ageGroups.map((a) => AGE_GROUPS.find(([k]) => k === a)?.[1] ?? a).join(", ")],
    ["Languages", n.languages.join(", ")],
    ["Areas", n.areas.join(", ")],
    ["Skills", n.skills.join(", ") || "—"],
    ["Drives", n.canDrive ? "Yes" : "No"],
    ["Specialist care", n.specialistExperience ? "Yes" : "—"],
  ];
}
