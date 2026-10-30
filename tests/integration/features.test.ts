import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, schema as s } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

/** Audits 6–7: the new journey, calendar sync, notifications, referrals/loyalty and insights against real Postgres. */
let current: CurrentUser | null = null;
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), assertUser: async () => { if (!current) throw new Error("Not signed in"); return current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));

const { acceptQuotation, assignNanny, createQuotation, respondToOffer, runMatching, sendQuotation, transition } = await import("@/lib/bookings");
const { recordManualPayment } = await import("@/lib/payments/service");
const J = await import("@/app/family/journey-actions");
const { saveDraft, availabilityFor, getDraft } = await import("@/lib/journey");
const { parseReq } = await import("@/lib/journey-core");
const cal = await import("@/lib/calendar/sync");
const { setProviderForTests } = await import("@/lib/calendar/providers");
const { notify, deliverPending, applyDeliveryStatus } = await import("@/lib/notify");
const growth = await import("@/lib/growth");
const { setSetting } = await import("@/lib/settings");
const { insights } = await import("@/lib/insights");
const { PRICE_ITEMS_V1, SERVICES } = await import("@/db/seed/reference");

const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);
const cu = (u: typeof s.users.$inferSelect, roles: Role[]): CurrentUser => ({ id: u.id, email: u.email, name: u.name, roles, permissions: u.permissions, status: "active", mfaEnabled: false, mfaPassed: true, isDemo: false, sessionId: "t" });
let admin: CurrentUser, ops: CurrentUser, famA: CurrentUser, famB: CurrentUser, n1U: CurrentUser, n2U: CurrentUser;
let familyA: string, familyB: string, childA: string, childB: string, n1: string, n2: string, hidden: string;
async function mkUser(email: string, role: Role) {
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], status: "active", emailVerifiedAt: new Date() }).returning();
  await db.insert(s.userRoles).values({ userId: u.id, role });
  return cu(u, [role]);
}
async function mkNanny(name: string, user: CurrentUser | null, published = true) {
  const [n] = await db.insert(s.nannies).values({ userId: user?.id ?? null, displayName: name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 4)}`, status: published ? "approved" : "draft", published, services: ["holiday"], languages: ["English"], ageGroups: ["preschool", "school"], areas: ["Atlantic Seaboard"], yearsExperience: 5 }).returning();
  await db.insert(s.verificationChecks).values(["interview", "reference", "identity", "police_clearance", "first_aid"].map((kind) => ({ nannyId: n.id, kind: kind as never, status: "passed" as const, expiresOn: "2099-01-01" })));
  return n.id;
}
async function mkFamily(user: CurrentUser) {
  const [f] = await db.insert(s.families).values({ displayName: `${user.name} household` }).returning();
  await db.insert(s.familyMembers).values({ familyId: f.id, userId: user.id, isPrimary: true });
  const [c] = await db.insert(s.children).values({ familyId: f.id, preferredName: "Kid", dateOfBirth: "2020-01-01" }).returning();
  return { f: f.id, c: c.id };
}
const fd = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x)); return f; };
const expectRedirect = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { url?: string }).url; } throw new Error("expected a redirect"); };

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, families, nannies, bookings, service_categories, price_books, public_holidays, notifications, audit_events, payment_events, rate_limits, consents, settings, tasks, integration_configs, calendar_connections, referral_codes, referrals, loyalty_ledger, booking_drafts RESTART IDENTITY CASCADE`);
  await db.insert(s.serviceCategories).values(SERVICES);
  const [pb] = await db.insert(s.priceBooks).values({ version: 1, label: "test", status: "published", effectiveFrom: new Date(Date.now() - 86400_000) }).returning();
  await db.insert(s.priceItems).values(PRICE_ITEMS_V1.map((i) => ({ ...i, priceBookId: pb.id })));
  admin = await mkUser("admin@f.test", "admin"); ops = await mkUser("ops@f.test", "ops");
  famA = await mkUser("a@f.test", "family"); famB = await mkUser("b@f.test", "family");
  n1U = await mkUser("n1@f.test", "nanny"); n2U = await mkUser("n2@f.test", "nanny");
  ({ f: familyA, c: childA } = await mkFamily(famA)); ({ f: familyB, c: childB } = await mkFamily(famB));
  n1 = await mkNanny("One", n1U); n2 = await mkNanny("Two", n2U); hidden = await mkNanny("Hidden", null, false);
});
afterAll(() => { setProviderForTests("google", null); });

describe("booking journey (server actions)", () => {
  it("shortlist toggles are per-family and refuse unpublished profiles", async () => {
    current = famA;
    expect(await J.toggleShortlistAction(n1)).toMatchObject({ saved: true, count: 1 });
    expect(await J.toggleShortlistAction(hidden)).toMatchObject({ error: expect.any(String) });
    current = famB;
    expect(await J.toggleShortlistAction(n2)).toMatchObject({ saved: true, count: 1 });
    current = famA;
    expect((await db.select().from(s.favourites).where(eq(s.favourites.familyId, familyA))).map((f) => f.nannyId)).toEqual([n1]);
  });

  it("validates requirements server-side and stores them in the draft", async () => {
    current = famA;
    const bad = await J.saveRequirementsAction(null, fd({ service: "holiday", start: day(-3), area: "" }));
    expect(bad?.fieldErrors).toMatchObject({ start: expect.any(String), area: expect.any(String) });
    const url = await expectRedirect(J.saveRequirementsAction(null, fd({ service: "holiday", start: day(60), area: "Atlantic Seaboard", kids: [childA, childB] })));
    expect(url).toMatch(/^\/family\/book\/nannies\?service=holiday/);
    expect((await getDraft(familyA)).req.kids).toEqual([childA]); // another household's child is dropped
  });

  it("submits from the draft, ignoring tampered preferences and browser-supplied requirements", async () => {
    current = famA;
    const url = await expectRedirect(J.submitJourneyAction(null, fd({ prefs: [n2, n1, hidden], terms: "on", service: "night", start: day(1) })));
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.familyId, familyA));
    expect(url).toBe(`/family/bookings/${b.id}?new=1`);
    expect(b.serviceCode).toBe("holiday");
    expect(b.startDate).toBe(day(60));
    expect(b.preferredNannyIds).toEqual([n1]); // n2 isn't on this family's shortlist; hidden isn't published
    expect(b.requestedNannyId).toBe(n1);
    expect((await getDraft(familyA)).updatedAt).toBeNull(); // draft cleared
  });

  it("asks Omega to help: creates a high-priority task; refuses when every preference is unavailable", async () => {
    current = famB;
    await saveDraft(familyB, famB.id, { req: parseReq({ service: "holiday", start: day(60), area: "Atlantic Seaboard", kids: childB }) });
    // n1 is not held yet (request only), so make n1 unavailable via time off for famB's attempt
    await db.insert(s.availabilityExceptions).values({ nannyId: n2, kind: "unavailable" as never, startsAt: new Date(`${day(59)}T00:00:00Z`), endsAt: new Date(`${day(62)}T00:00:00Z`) });
    expect(await J.submitJourneyAction(null, fd({ prefs: [n2], terms: "on" }))).toMatchObject({ error: expect.stringMatching(/None of your chosen nannies is free/) });
    await expectRedirect(J.submitJourneyAction(null, fd({ prefs: [n2], assistance: "on", terms: "on" })));
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.familyId, familyB));
    expect(b.assistanceRequested).toBe(true);
    expect((await db.select().from(s.tasks).where(eq(s.tasks.bookingId, b.id)))[0].title).toMatch(/Help choose a nanny/);
    expect((await availabilityFor([n2], parseReq({ service: "holiday", start: day(60) })))[n2]).toBe("unavailable");
  });

  it("matching ranks the family's first preference", async () => {
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.familyId, familyA));
    const r = await runMatching(admin, b.id);
    expect(r.find((x: { nannyId: string }) => x.nannyId === n1)!.reasons.some((x: { text: string }) => x.text === "Family's 1st preference")).toBe(true);
  });
});

// ---------- Calendar sync with a fake provider ----------
type Ev = { id: string; summary: string; start: Date; end: Date; omegaKey: string };
const store = new Map<string, Ev>(); let changes: { id: string; cancelled: boolean; busy: boolean; start: Date | null; end: Date | null; omegaKey?: string }[] = []; let fail401 = false; let writes = 0;
const fake = {
  id: "google" as const, label: "Fake", configured: () => true, authUrl: () => "https://fake/auth",
  exchangeCode: async () => ({ accessToken: "acc", refreshToken: "ref", expiresAt: new Date(Date.now() + 3600_000) }),
  refresh: async () => ({ accessToken: "acc2", refreshToken: null, expiresAt: new Date(Date.now() + 3600_000) }),
  accountEmail: async () => "x@example.com",
  upsertEvent: async (_t: string, _c: string, ev: Omit<Ev, "id">, id?: string | null) => { if (fail401) { const { ProviderError } = await import("@/lib/calendar/providers"); throw new ProviderError("expired", 401, true); } writes++; const eid = id && store.has(id) ? id : `ev${store.size + 1}`; store.set(eid, { ...ev, id: eid }); return { id: eid }; },
  deleteEvent: async (_t: string, _c: string, id: string) => { store.delete(id); },
  listChanges: async () => ({ events: changes, nextSyncToken: "tok" }),
  watch: async () => ({ resourceId: null, expiresAt: new Date(Date.now() + 86400_000) }),
};
async function connect(userId: string, expired = false) {
  const [c] = await db.insert(s.calendarConnections).values({ userId, provider: "google", accessTokenEnc: cal.seal("acc"), refreshTokenEnc: cal.seal("ref"), tokenExpiresAt: new Date(Date.now() + (expired ? -1000 : 3600_000)) }).returning();
  return c;
}
async function confirmedBooking(fam: CurrentUser, familyId: string, childId: string, nannyId: string, nannyUser: CurrentUser, start: number, end = start) {
  const { createBookingRequest } = await import("@/lib/bookings");
  const b = await createBookingRequest(fam, { familyId, serviceCode: "holiday", startDate: day(start), endDate: day(end), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childId], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: true });
  await runMatching(admin, b.id); await assignNanny(admin, b.id, nannyId); await respondToOffer(nannyUser, b.id, true);
  const q = await createQuotation(admin, b.id, { adjustmentMinor: 0, adjustmentReason: null, travelTrips: 0, validDays: 7 });
  await sendQuotation(admin, q.id); await acceptQuotation(fam, q.id, true);
  const [inv] = await db.select().from(s.invoices).where(and(eq(s.invoices.bookingId, b.id), eq(s.invoices.kind, "deposit")));
  await recordManualPayment(admin, inv.id, `EFT-${randomUUID().slice(0, 8)}`);
  return b;
}

describe("two-way calendar sync", () => {
  let bookingId = ""; let nannyConn: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => { setProviderForTests("google", fake as never); });

  it("stores tokens encrypted, never in plain text", async () => {
    nannyConn = await connect(n1U.id);
    await connect(famA.id);
    expect(nannyConn.accessTokenEnc).not.toContain("acc");
    expect(cal.unseal(nannyConn.accessTokenEnc!)).toBe("acc");
  });

  it("creates one event per session for nanny and family, with no private details, and never duplicates", async () => {
    const b = await confirmedBooking(famA, familyA, childA, n1, n1U, 100, 102);
    bookingId = b.id;
    await new Promise((r) => setTimeout(r, 300)); // let the post-commit hook finish
    await Promise.all([cal.syncBooking(b.id), cal.syncBooking(b.id)]); // concurrent syncs
    expect(store.size).toBe(6); // 3 sessions × 2 calendars
    const before = writes;
    await cal.syncBooking(b.id);
    expect(writes).toBe(before);
    for (const e of store.values()) expect(e.summary).not.toMatch(/Kid|Test Road|allerg/i);
  });

  it("treats an outside edit as a conflict: booking unchanged, task raised, restore re-writes the event", async () => {
    const [link] = await db.select().from(s.calendarEventLinks).where(and(eq(s.calendarEventLinks.connectionId, nannyConn.id), eq(s.calendarEventLinks.bookingId, bookingId)));
    const moved = new Date(link.sessionStart!.getTime() + 3600_000);
    changes = [{ id: link.providerEventId!, cancelled: false, busy: true, start: moved, end: new Date(moved.getTime() + 3600_000) }];
    expect((await cal.syncIncoming(nannyConn.id)).conflicts).toBe(1);
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
    expect(b.status).toBe("confirmed");
    const [conf] = await db.select().from(s.calendarConflicts).where(eq(s.calendarConflicts.status, "open"));
    expect((await db.select().from(s.tasks).where(eq(s.tasks.bookingId, bookingId))).some((t) => t.title.startsWith("Calendar conflict"))).toBe(true);
    expect(await cal.syncIncoming(nannyConn.id)).toMatchObject({ conflicts: 0 }); // not raised twice
    const w = writes;
    expect(await cal.resolveConflict(admin.id, conf.id, "restore")).toBe(true);
    expect(writes).toBe(w + 1);
    changes = [];
  });

  it("imports busy times as start/end only and uses them for availability; free/cancelled events are removed", async () => {
    const s0 = new Date(`${day(120)}T08:00:00Z`), e0 = new Date(`${day(120)}T18:00:00Z`);
    changes = [{ id: "private-dentist", cancelled: false, busy: true, start: s0, end: e0 }];
    await cal.syncIncoming(nannyConn.id);
    const blocks = await db.select().from(s.calendarBusyBlocks).where(eq(s.calendarBusyBlocks.connectionId, nannyConn.id));
    expect(blocks).toHaveLength(1);
    expect(Object.keys(blocks[0])).not.toContain("summary");
    expect((await availabilityFor([n1], parseReq({ service: "holiday", start: day(120) })))[n1]).toBe("unavailable");
    changes = [{ id: "private-dentist", cancelled: true, busy: true, start: null, end: null }];
    await cal.syncIncoming(nannyConn.id);
    expect(await db.select().from(s.calendarBusyBlocks).where(eq(s.calendarBusyBlocks.connectionId, nannyConn.id))).toHaveLength(0);
    changes = [];
  });

  it("removes events when the booking is cancelled", async () => {
    await transition(admin, bookingId, "cancelled", "test");
    await cal.syncBooking(bookingId);
    expect(store.size).toBe(0);
  });

  it("refreshes expired tokens and marks revoked access for re-authorisation", async () => {
    const c = await connect(n2U.id, true);
    await cal.syncIncoming(c.id);
    const [after] = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.id, c.id));
    expect(cal.unseal(after.accessTokenEnc!)).toBe("acc2");
    fail401 = true;
    const b = await confirmedBooking(famB, familyB, childB, n2, n2U, 130);
    await cal.syncBooking(b.id);
    const [re] = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.id, c.id));
    expect(re.status).toBe("needs_reauth");
    fail401 = false;
  });

  it("verifies webhook channel secrets", async () => {
    await db.update(s.calendarConnections).set({ channelId: "chan1", channelTokenHash: (await import("@/lib/crypto")).sha256("s3cret") }).where(eq(s.calendarConnections.id, nannyConn.id));
    expect(await cal.connectionForWebhook("google", "chan1", "wrong")).toBeNull();
    expect((await cal.connectionForWebhook("google", "chan1", "s3cret"))?.id).toBe(nannyConn.id);
    expect(await cal.connectionForWebhook("google", null, "s3cret")).toBeNull();
  });
});

describe("manual payments", () => {
  it("rejects a reused bank reference with a clear message", async () => {
    const [p] = await db.select().from(s.payments).where(eq(s.payments.provider, "manual")).limit(1);
    const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.status, "open")).limit(1);
    await expect(recordManualPayment(admin, inv.id, p.providerRef!)).rejects.toThrow(/already been recorded/);
  });
});

describe("multi-channel notifications", () => {
  it("only queues channels the user consented to and never reports undelivered messages as delivered", async () => {
    await db.update(s.users).set({ phone: "+27821234567" }).where(eq(s.users.id, famB.id));
    await db.insert(s.notificationPreferences).values({ userId: famB.id, channels: { bookings: { email: true, sms: true, whatsapp: true } }, smsConsentAt: new Date() }).onConflictDoUpdate({ target: s.notificationPreferences.userId, set: { channels: { bookings: { email: true, sms: true, whatsapp: true } }, smsConsentAt: new Date() } });
    await notify(famB.id, "booking_cancelled", { ref: "ON-1", note: "" }, "t:1");
    await notify(famB.id, "booking_cancelled", { ref: "ON-1", note: "" }, "t:1"); // duplicate
    const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, famB.id), eq(s.notifications.dedupeKey, "t:1")));
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "sms"]);
    expect(rows.find((r) => r.channel === "sms")!.body).not.toMatch(/Test Road|Kid/);
    await deliverPending(50);
    const sms = (await db.select().from(s.notifications).where(and(eq(s.notifications.userId, famB.id), eq(s.notifications.channel, "sms"))))[0];
    expect(sms.status).toBe("captured"); // no provider configured in tests
  });

  it("marks delivered only on the provider callback, and never regresses", async () => {
    const [r] = await db.insert(s.notifications).values({ userId: famB.id, dedupeKey: "t:2", channel: "sms", template: "x", subject: "x", body: "x", status: "sent", providerRef: "SMabc" }).returning();
    expect(await applyDeliveryStatus("SMabc", "delivered")).toBe(1);
    expect(await applyDeliveryStatus("SMabc", "failed")).toBe(0);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.id, r.id)))[0].status).toBe("delivered");
  });
});

describe("referrals & loyalty", () => {
  it("records attribution but awards nothing while programmes are off; blocks self-referral", async () => {
    const code = await growth.ensureReferralCode(familyA, famA.id);
    expect(code.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await growth.attributeReferral(code.code, famA.id, familyA)).toBeNull();
    expect(await growth.attributeReferral(code.code, famB.id, familyB)).not.toBeNull();
    const b = await confirmedBooking(famB, familyB, childB, n1, n1U, 140);
    await transition(admin, b.id, "in_progress"); await transition(admin, b.id, "completed");
    await growth.onBookingForGrowth(b.id, "completed");
    expect(await db.select().from(s.loyaltyLedger)).toHaveLength(0);
    (globalThis as { _b?: string })._b = b.id;
  });

  it("when active: rewards wait for approval, need the payments permission, and are granted once", async () => {
    await setSetting("referral", { enabled: true, rewardType: "credit", rewardValue: 20000, qualification: "first_completed_booking", expiryDays: 365, maxRewardsPerReferrer: 10, services: [], requireApproval: true }, admin.id);
    await setSetting("loyalty", { enabled: true, pointsPerCompletedBooking: 50, milestoneEvery: 0, milestonePoints: 0 }, admin.id);
    const bid = (globalThis as { _b?: string })._b!;
    await growth.onBookingForGrowth(bid, "completed");
    await growth.onBookingForGrowth(bid, "completed"); // replay
    const [r] = await db.select().from(s.referrals);
    expect(r.status).toBe("pending_approval");
    expect((await growth.balances(familyB)).points).toBe(50); // loyalty once, despite the replay
    await expect(growth.decideReferral(ops, r.id, true)).rejects.toThrow(/permission/);
    await growth.decideReferral(admin, r.id, true);
    await expect(growth.decideReferral(admin, r.id, true)).rejects.toThrow(/not awaiting/);
    expect((await growth.balances(familyA)).creditMinor).toBe(20000);
    await expect(growth.adjustLedger(admin, familyA, "credit_minor", -30000, "redemption", "Applied to invoice")).rejects.toThrow(/negative/);
    await expect(growth.adjustLedger(ops, familyA, "credit_minor", 100, "adjustment", "Goodwill gesture")).rejects.toThrow(/permission/);
  });
});

describe("management insights", () => {
  it("returns aggregates from real records only", async () => {
    const d = await insights({ from: day(-1), to: day(1) });
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(s.bookings).where(sql`created_at::date BETWEEN ${day(-1)} AND ${day(1)}`);
    expect(d.ov.requests).toBe(c);
    expect(d.money.collected).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/@f\.test|Kid/); // no emails or children
    expect((await insights({ from: day(-1), to: day(1), service: "night" })).ov.requests).toBe(0);
  });
});
