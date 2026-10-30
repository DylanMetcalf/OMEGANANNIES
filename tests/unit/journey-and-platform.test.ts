import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classify, compareRows, EMPTY_REQ, filterAndSort, orderPreferences, paginate, parseFilters, parseReq, reqToParams, showAverage, validateReq, type DiscoverNanny } from "@/lib/journey-core";
import { progressStages } from "@/lib/booking-progress";
import { channelsFor, normalizePhone, retryDue } from "@/lib/channels";
import { verifySvix, verifyTwilio } from "@/lib/webhook-signatures";
import { entryPath, pathFitsRoles, safeNext } from "@/lib/site";

const n = (o: Partial<DiscoverNanny> & { id: string; displayName: string }): DiscoverNanny => ({ headline: "", bio: "", yearsExperience: 5, languages: ["English"], areas: ["Atlantic Seaboard"], skills: [], ageGroups: ["school"], services: ["holiday"], canDrive: false, specialistExperience: null, ...o });

describe("journey requirements", () => {
  it("parses leniently and drops malformed or hostile values", () => {
    const r = parseReq({ service: "holiday; drop table", start: "2026-13-40", t1: "25:00", kids: ["x", "3f0e0d9a-1111-4222-8333-444455556666"], weekdays: "1,9,3,3", minExp: "999", langs: "English,<script>" });
    expect(r.service).toBe("");
    expect(r.start).toBe("");
    expect(r.t1).toBe("09:00");
    expect(r.kids).toEqual(["3f0e0d9a-1111-4222-8333-444455556666"]);
    expect(r.weekdays).toEqual([1, 3]);
    expect(r.minExp).toBe(30);
    expect(r.langs).toEqual(["English"]);
  });
  it("round-trips through the URL without notes", () => {
    const r = { ...EMPTY_REQ, service: "holiday", start: "2026-12-01", end: "2026-12-10", recurring: true, weekdays: [1, 3, 5], area: "Garden Route", notes: "private" };
    const back = parseReq(Object.fromEntries(reqToParams(r)));
    expect({ ...back, notes: "private" }).toEqual(r);
    expect(reqToParams(r).toString()).not.toContain("private");
  });
  it("validates conditionally: recurring needs an end date and weekdays; no children means ages", () => {
    const base = { ...EMPTY_REQ, service: "holiday", start: "2026-12-01", area: "X" };
    expect(validateReq({ ...base, recurring: true }, "2026-11-01", false)).toMatchObject({ end: expect.any(String), weekdays: expect.any(String), ages: expect.any(String) });
    expect(validateReq({ ...base, start: "2026-10-01" }, "2026-11-01", true).start).toMatch(/passed/);
    expect(validateReq({ ...base, kids: ["k"] }, "2026-11-01", true)).toEqual({});
    expect(validateReq({ ...base, kids: ["k"], end: "2027-06-01" }, "2026-11-01", true).end).toMatch(/120 days/);
  });
});

describe("discovery filtering & ranking", () => {
  const all = [
    n({ id: "a", displayName: "Amy", yearsExperience: 10, languages: ["English", "German"], ageGroups: ["toddler", "school"], canDrive: true }),
    n({ id: "b", displayName: "Bea", yearsExperience: 2, areas: ["Garden Route"], services: ["holiday", "night"] }),
    n({ id: "c", displayName: "Cal", services: ["night"] }),
  ];
  const f = parseFilters({});
  it("treats the family's musts as hard filters and the rest as ranking", () => {
    const req = { ...EMPTY_REQ, service: "holiday", area: "Atlantic Seaboard", ages: ["toddler"] };
    const r = filterAndSort(all, req, f, { a: "available", b: "unavailable" }, {});
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r[0].reasons).toContain("Free on your dates");
    expect(filterAndSort(all, { ...req, langs: ["German"] }, f, {}, {}).map((x) => x.id)).toEqual(["a"]);
    expect(filterAndSort(all, { ...req, driver: true }, f, {}, {}).map((x) => x.id)).toEqual(["a"]);
  });
  it("applies search, filters and sorting, and hides unavailable only on request", () => {
    expect(filterAndSort(all, EMPTY_REQ, parseFilters({ q: "be" }), {}, {}).map((x) => x.id)).toEqual(["b"]);
    expect(filterAndSort(all, EMPTY_REQ, parseFilters({ favail: "1" }), { a: "unavailable" }, {}).map((x) => x.id)).toEqual(["c", "b"]);
    expect(filterAndSort(all, EMPTY_REQ, parseFilters({ sort: "experience" }), {}, {}).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(filterAndSort(all, EMPTY_REQ, parseFilters({ sort: "name" }), {}, {}).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filterAndSort(all, EMPTY_REQ, parseFilters({ frating: "4" }), {}, { b: { avg: 4.5, n: 3 } }).map((x) => x.id)).toEqual(["b"]);
  });
  it("paginates and classifies availability", () => {
    expect(paginate(Array.from({ length: 25 }, (_, i) => i), 3)).toEqual({ items: [24], pages: 3 });
    const d = (h: number) => new Date(Date.UTC(2026, 11, 1, h));
    const sess = [{ startsAt: d(9), endsAt: d(17) }, { startsAt: d(33), endsAt: d(41) }];
    expect(classify(sess, [])).toBe("available");
    expect(classify(sess, [{ startsAt: d(10), endsAt: d(11) }])).toBe("partial");
    expect(classify(sess, [{ startsAt: d(0), endsAt: d(48) }])).toBe("unavailable");
    expect(classify([], [])).toBeNull();
  });
  it("keeps preference order, drops non-shortlisted and duplicates, caps at three", () => {
    expect(orderPreferences(["x", "a", "b", "a", "c", "d"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
  });
  it("shows an average only from three reviews; comparison has no private fields", () => {
    expect(showAverage({ avg: 5, n: 2 })).toBe(false);
    expect(showAverage({ avg: 4.7, n: 3 })).toBe(true);
    const rows = compareRows({ ...all[0], availability: null, rating: { avg: 5, n: 1 } }, { holiday: "Holiday Nanny" });
    expect(rows.find(([k]) => k === "Reviews")?.[1]).toBe("1 review");
    expect(rows.map(([k]) => k).join(" ")).not.toMatch(/address|phone|email|document|check/i);
  });
});

describe("booking progress (real state only)", () => {
  const b = { status: "enquiry", preferredNannyIds: ["n1"], assistanceRequested: false, nannyId: null, nannyResponse: null };
  it("shows only relevant stages and the right current one", () => {
    expect(progressStages({ ...b, preferredNannyIds: [] })!.map((s) => s.key)).not.toContain("prefs");
    expect(progressStages(b)!.find((s) => s.state === "current")?.key).toBe("review");
    expect(progressStages({ ...b, status: "matching", nannyId: "n1", nannyResponse: "pending" })!.find((s) => s.state === "current")?.key).toBe("nanny");
    expect(progressStages({ ...b, status: "awaiting_payment", nannyId: "n1", nannyResponse: "accepted" })!.find((s) => s.state === "current")?.key).toBe("pay");
    expect(progressStages({ ...b, status: "confirmed", nannyId: "n1", nannyResponse: "accepted" })!.every((s) => s.state === "done")).toBe(true);
    expect(progressStages({ ...b, status: "cancelled" })).toBeNull();
  });
});

describe("channels", () => {
  it("normalises South African and international mobile numbers", () => {
    expect(normalizePhone("082 123 4567")).toBe("+27821234567");
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("123")).toBeNull();
  });
  const pref = { emailBookings: true, emailMessages: false, emailReminders: true, marketingOptIn: false, channels: { bookings: { email: true, sms: true, whatsapp: true } }, smsConsentAt: new Date(), whatsappConsentAt: null };
  it("needs a number and consent per channel; security always emails; marketing only on opt-in", () => {
    expect(channelsFor("bookings", pref, "0821234567")).toEqual(["email", "sms"]);
    expect(channelsFor("bookings", pref, null)).toEqual(["email"]);
    expect(channelsFor("messages", pref, "0821234567")).toEqual([]);
    expect(channelsFor("security", { ...pref, channels: { bookings: { email: false } } }, null)).toEqual(["email"]);
    expect(channelsFor("marketing", pref, null)).toEqual([]);
    expect(channelsFor("bookings", undefined, null)).toEqual(["email"]);
  });
  it("backs off retries and stops after five attempts", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(retryDue(1, t, new Date(t.getTime() + 30_000))).toBe(false);
    expect(retryDue(1, t, new Date(t.getTime() + 61_000))).toBe(true);
    expect(retryDue(3, t, new Date(t.getTime() + 3 * 60_000))).toBe(false);
    expect(retryDue(5, t, new Date(t.getTime() + 86400_000))).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("verifies Twilio and rejects tampering", () => {
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const sig = createHmac("sha1", "tok").update("https://x/cb" + "MessageSidSM1MessageStatusdelivered").digest("base64");
    expect(verifyTwilio("tok", "https://x/cb", params, sig)).toBe(true);
    expect(verifyTwilio("tok", "https://x/cb", { ...params, MessageStatus: "failed" }, sig)).toBe(false);
    expect(verifyTwilio("", "https://x/cb", params, sig)).toBe(false);
  });
  it("verifies Svix with a time tolerance", () => {
    const secret = "whsec_" + Buffer.from("k3y").toString("base64"), now = 1_800_000_000_000, ts = String(now / 1000), body = '{"type":"email.delivered"}';
    const sig = createHmac("sha256", Buffer.from("k3y")).update(`m1.${ts}.${body}`).digest("base64");
    expect(verifySvix(secret, { id: "m1", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(true);
    expect(verifySvix(secret, { id: "m1", timestamp: ts, signature: `v1,${sig}` }, body + " ", now)).toBe(false);
    expect(verifySvix(secret, { id: "m1", timestamp: ts, signature: `v1,${sig}` }, body, now + 10 * 60_000)).toBe(false);
  });
});

describe("website ↔ portal redirects", () => {
  it("accepts only same-origin portal paths", () => {
    expect(safeNext("/family/book?service=holiday")).toBe("/family/book?service=holiday");
    for (const bad of ["//evil.com", "https://evil.com/family", "/\\evil.com", "/login", "/%2F%2Fevil.com", "javascript:alert(1)", "/family\u0000x"]) expect(safeNext(bad)).toBeNull();
    expect(pathFitsRoles("/manage", ["family"])).toBe(false);
    expect(pathFitsRoles("/family/book", ["family"])).toBe(true);
  });
  it("maps website intents and service slugs to the booking journey", () => {
    expect(entryPath("book", "holiday-nanny").path).toBe("/family/book?service=holiday");
    expect(entryPath("find", null).path).toBe("/family/book/nannies");
    expect(entryPath("nanny-login", null).path).toBe("/login");
    expect(entryPath("book", "../../etc").path).toBe("/family/book");
  });
});
