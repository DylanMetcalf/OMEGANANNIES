import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { acceptQuotation, assignNanny, bookingAccess, ConflictError, createBookingRequest, createQuotation, DomainError, respondToOffer, runMatching, sendQuotation } from "@/lib/bookings";
import { claimInvitation, createNannyProfile, issueInvitation, lifecycle, onboardingContext, revokeInvitation, setContact } from "@/lib/onboarding";
import { setSetting } from "@/lib/settings";
import { PRICE_ITEMS_V1, SERVICES } from "@/db/seed/reference";
import type { CurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

/** Audit 2 negative tests: each one attempts something an attacker or a confused user might try. */
const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);
const cu = (u: typeof s.users.$inferSelect, roles: Role[]): CurrentUser => ({ id: u.id, email: u.email, name: u.name, roles, permissions: u.permissions, status: "active", mfaEnabled: false, mfaPassed: true, isDemo: false, sessionId: "test" });
let admin: CurrentUser, ops: CurrentUser, famA: CurrentUser, famB: CurrentUser, nanny1U: CurrentUser, nanny2U: CurrentUser;
let familyA: string, familyB: string, childA: string, childB: string, nanny1: string, nanny2: string;
const PW = "a-strong-password-123";

async function mkUser(email: string, role: Role, permissions: string[] = []) {
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], status: "active", emailVerifiedAt: new Date(), permissions }).returning();
  await db.insert(s.userRoles).values({ userId: u.id, role });
  return cu(u, [role]);
}
async function mkNanny(name: string, user: CurrentUser) {
  const [n] = await db.insert(s.nannies).values({ userId: user.id, displayName: name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 4)}`, status: "approved", published: true, services: ["holiday"], languages: ["English"], ageGroups: ["preschool", "school"], areas: ["Atlantic Seaboard"], yearsExperience: 5 }).returning();
  await db.insert(s.verificationChecks).values(["interview", "reference", "identity", "police_clearance", "first_aid"].map((kind) => ({ nannyId: n.id, kind: kind as never, status: "passed" as const, expiresOn: "2099-01-01" })));
  return n.id;
}
async function mkFamily(user: CurrentUser) {
  const [f] = await db.insert(s.families).values({ displayName: `${user.name} household` }).returning();
  await db.insert(s.familyMembers).values({ familyId: f.id, userId: user.id, isPrimary: true });
  const [c] = await db.insert(s.children).values({ familyId: f.id, preferredName: "Kid", dateOfBirth: "2020-01-01" }).returning();
  return { f: f.id, c: c.id };
}
const request = (u: CurrentUser, familyId: string, childId: string, start: number, end = start) => createBookingRequest(u, {
  familyId, serviceCode: "holiday", startDate: day(start), endDate: day(end), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childId], requestedNannyId: null,
  liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: true,
});
async function quoted(fam: CurrentUser, familyId: string, childId: string, nannyId: string, nannyUser: CurrentUser, start: number, end = start) {
  const b = await request(fam, familyId, childId, start, end);
  await runMatching(admin, b.id);
  await assignNanny(admin, b.id, nannyId);
  await respondToOffer(nannyUser, b.id, true);
  const q = await createQuotation(admin, b.id, { adjustmentMinor: 0, adjustmentReason: null, travelTrips: 0, validDays: 7 });
  await sendQuotation(admin, q.id);
  return { b, q };
}

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, families, nannies, bookings, service_categories, price_books, public_holidays, notifications, audit_events, payment_events, rate_limits, consents, settings RESTART IDENTITY CASCADE`);
  await db.insert(s.serviceCategories).values(SERVICES);
  const [pb] = await db.insert(s.priceBooks).values({ version: 1, label: "test", status: "published", effectiveFrom: new Date(Date.now() - 86400_000) }).returning();
  await db.insert(s.priceItems).values(PRICE_ITEMS_V1.map((i) => ({ ...i, priceBookId: pb.id })));
  admin = await mkUser("admin@sec.test", "admin");
  ops = await mkUser("ops@sec.test", "ops");
  famA = await mkUser("a@sec.test", "family"); famB = await mkUser("b@sec.test", "family");
  nanny1U = await mkUser("n1@sec.test", "nanny"); nanny2U = await mkUser("n2@sec.test", "nanny");
  ({ f: familyA, c: childA } = await mkFamily(famA)); ({ f: familyB, c: childB } = await mkFamily(famB));
  nanny1 = await mkNanny("One", nanny1U); nanny2 = await mkNanny("Two", nanny2U);
});

describe("pre-created profiles & invitation claiming", () => {
  it("creates a draft without an email and never treats it as approved or invited", async () => {
    const n = await createNannyProfile(admin, { displayName: "Draft Only" });
    const ctx = await onboardingContext([n.id]);
    expect(lifecycle(n, { invitation: ctx.invitations[0], docs: ctx.docs, checks: ctx.checks }).key).toBe("draft");
    await expect(issueInvitation(admin, n.id)).rejects.toThrow(/email address first/);
    await expect(createNannyProfile(ops, { displayName: "Nope" })).rejects.toThrow(/permission/);
  });

  it("binds a claim to the invited email, is single-use, and resists replay and races", async () => {
    const n = await createNannyProfile(admin, { displayName: "Claimer", contactEmail: "claimer@sec.test" });
    const { link } = await issueInvitation(admin, n.id);
    const token = link.split("token=")[1];
    const [inv] = await db.select().from(s.nannyInvitations).where(eq(s.nannyInvitations.nannyId, n.id));
    expect(inv.tokenHash).not.toContain(token); // stored hashed, never in plain text
    expect(token.length).toBeGreaterThanOrEqual(40);
    await expect(claimInvitation({ token, email: "attacker@sec.test", name: "Mallory", password: PW, ip: "1.1.1.1" })).rejects.toThrow(/isn’t valid/);
    // Two simultaneous valid claims: exactly one wins.
    const results = await Promise.allSettled([1, 2].map(() => claimInvitation({ token, email: "Claimer@sec.test", name: "Claimer", password: PW, ip: "1.1.1.2" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // Replay after success
    await expect(claimInvitation({ token, email: "claimer@sec.test", name: "Again", password: PW, ip: "1.1.1.3" })).rejects.toThrow(/isn’t valid/);
    const [claimed] = await db.select().from(s.nannies).where(eq(s.nannies.id, n.id));
    expect(claimed.userId).toBeTruthy();
    expect(claimed.status).toBe("onboarding"); // claiming never approves
    expect(claimed.published).toBe(false);
    await expect(issueInvitation(admin, n.id)).rejects.toThrow(/already been claimed/);
  });

  it("rejects expired and revoked invitations, and revokes after repeated wrong emails", async () => {
    const n = await createNannyProfile(admin, { displayName: "Expiry", contactEmail: "expiry@sec.test" });
    const t1 = (await issueInvitation(admin, n.id)).link.split("token=")[1];
    await db.update(s.nannyInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.nannyInvitations.nannyId, n.id));
    await expect(claimInvitation({ token: t1, email: "expiry@sec.test", name: "Xavier", password: PW, ip: "2.2.2.1" })).rejects.toThrow(/isn’t valid/);
    const t2 = (await issueInvitation(admin, n.id)).link.split("token=")[1];
    const [open] = await db.select().from(s.nannyInvitations).where(sql`${s.nannyInvitations.nannyId} = ${n.id} AND status = 'sent'`);
    await revokeInvitation(admin, open.id);
    await expect(claimInvitation({ token: t2, email: "expiry@sec.test", name: "Xavier", password: PW, ip: "2.2.2.2" })).rejects.toThrow(/isn’t valid/);
    const t3 = (await issueInvitation(admin, n.id)).link.split("token=")[1];
    for (let i = 0; i < 5; i++) await expect(claimInvitation({ token: t3, email: `guess${i}@sec.test`, name: "Xavier", password: PW, ip: `3.3.3.${i}` })).rejects.toThrow();
    await expect(claimInvitation({ token: t3, email: "expiry@sec.test", name: "Xavier", password: PW, ip: "3.3.3.9" })).rejects.toThrow(/isn’t valid/);
  });

  it("changing the contact email revokes the open invitation; duplicate emails are refused", async () => {
    const n = await createNannyProfile(admin, { displayName: "Mover", contactEmail: "mover@sec.test" });
    const t = (await issueInvitation(admin, n.id)).link.split("token=")[1];
    await setContact(admin, n.id, "mover2@sec.test", null);
    await expect(claimInvitation({ token: t, email: "mover@sec.test", name: "Xavier", password: PW, ip: "4.4.4.4" })).rejects.toThrow(/isn’t valid/);
    await expect(createNannyProfile(admin, { displayName: "Dup", contactEmail: "mover2@sec.test" })).rejects.toThrow(/already uses this email/);
    await expect(createNannyProfile(admin, { displayName: "Dup", contactEmail: "a@sec.test" })).rejects.toThrow(/already belongs to a portal account/);
  });
});

describe("cross-account and cross-role isolation", () => {
  it("a family cannot see or act on another household's booking, child or quotation", async () => {
    const { b, q } = await quoted(famA, familyA, childA, nanny1, nanny1U, 30);
    expect((await bookingAccess(famB, b)).level).toBe("none");
    await expect(acceptQuotation(famB, q.id, true)).rejects.toThrow(/not found/i);
    await expect(request(famB, familyB, childA, 31)).rejects.toThrow(/Invalid child/);
    await expect(request(famA, familyB, childB, 31)).rejects.toThrow(/not authorised/);
  });

  it("an unrelated nanny cannot see the booking; the offered nanny sees no address until the reveal point", async () => {
    const b = await request(famA, familyA, childA, 40);
    await runMatching(admin, b.id);
    await assignNanny(admin, b.id, nanny1);
    const [pending] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.id));
    expect((await bookingAccess(nanny2U, pending)).level).toBe("none");
    expect(await bookingAccess(nanny1U, pending)).toMatchObject({ level: "nanny", sensitive: false, preciseLocation: false });
    await expect(respondToOffer(nanny2U, b.id, true)).rejects.toThrow(/no longer open/);
    await respondToOffer(nanny1U, b.id, false);
    const [declined] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.id));
    expect((await bookingAccess(nanny1U, declined)).level).toBe("none"); // declined offers disappear
    await expect(respondToOffer(nanny1U, b.id, true)).rejects.toThrow(/no longer open/);
  });

  it("honours a stricter address-reveal setting", async () => {
    await setSetting("addressReveal", "in_progress", admin.id);
    const [b] = await db.insert(s.bookings).values({ reference: `SEC-${randomUUID().slice(0, 6)}`, familyId: familyA, nannyId: nanny1, nannyResponse: "accepted", serviceCode: "holiday", status: "confirmed", startDate: day(50), endDate: day(50), dailyStartMinute: 540, dailyEndMinute: 1020 }).returning();
    expect((await bookingAccess(nanny1U, b)).sensitive).toBe(false);
    expect((await bookingAccess(nanny1U, { ...b, status: "in_progress" })).sensitive).toBe(true);
    await setSetting("addressReveal", "confirmed", admin.id);
    expect((await bookingAccess(nanny1U, b)).sensitive).toBe(true);
  });

  it("refuses to send a quotation before the nanny accepts (when required)", async () => {
    const b = await request(famA, familyA, childA, 60);
    await runMatching(admin, b.id);
    await assignNanny(admin, b.id, nanny2);
    const q = await createQuotation(admin, b.id, { adjustmentMinor: 0, adjustmentReason: null, travelTrips: 0, validDays: 7 });
    await expect(sendQuotation(admin, q.id)).rejects.toThrow(/nanny to accept/);
  });
});

describe("booking race conditions", () => {
  it("two families accepting overlapping quotes for the same nanny at the same moment: exactly one holds", async () => {
    const a = await quoted(famA, familyA, childA, nanny2, nanny2U, 70, 72);
    const b = await quoted(famB, familyB, childB, nanny2, nanny2U, 71, 73);
    const r = await Promise.allSettled([acceptQuotation(famA, a.q.id, true), acceptQuotation(famB, b.q.id, true)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
  });

  it("a double-submitted request creates one booking", async () => {
    const key = randomUUID();
    const mk = () => createBookingRequest(famA, { familyId: familyA, serviceCode: "holiday", startDate: day(90), endDate: day(90), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childA], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: key, termsAccepted: true });
    const [x, y] = await Promise.all([mk(), mk()]);
    expect(x.id).toBe(y.id);
    const rows = await db.select().from(s.bookings).where(eq(s.bookings.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("weekday patterns only create sessions on the chosen days", async () => {
    const start = day(100);
    const b = await createBookingRequest(famA, { familyId: familyA, serviceCode: "holiday", startDate: start, endDate: day(113), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childA], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: true, weekdays: [1, 3] });
    const sessions = await db.select().from(s.bookingSessions).where(eq(s.bookingSessions.bookingId, b.id));
    expect(sessions.length).toBe(4);
    await expect(createBookingRequest(famA, { familyId: familyA, serviceCode: "holiday", startDate: day(120), endDate: day(120), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childA], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: true, weekdays: [new Date(day(121) + "T12:00:00Z").getUTCDay()] })).rejects.toBeInstanceOf(DomainError);
  });
});
