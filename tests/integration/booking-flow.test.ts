import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { acceptQuotation, assignNanny, bookingAccess, ConflictError, createBookingRequest, createQuotation, DomainError, respondToOffer, runMatching, sendQuotation, transition } from "@/lib/bookings";
import { notify } from "@/lib/notify";
import { applyPaymentEvent, startPayment } from "@/lib/payments/service";
import { PRICE_ITEMS_V1, SERVICES } from "@/db/seed/reference";
import type { CurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);
const cu = (u: typeof s.users.$inferSelect, roles: Role[]): CurrentUser => ({ id: u.id, email: u.email, name: u.name, roles, permissions: u.permissions, status: "active", mfaEnabled: false, mfaPassed: true, isDemo: false, sessionId: "test" });

let manager: CurrentUser, famA: CurrentUser, famB: CurrentUser, nannyU: CurrentUser, otherNannyU: CurrentUser;
let familyA: string, familyB: string, childA: string, childB: string, nannyId: string, otherNannyId: string;

async function mkUser(email: string, role: Role) {
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], status: "active", emailVerifiedAt: new Date() }).returning();
  await db.insert(s.userRoles).values({ userId: u.id, role });
  return cu(u, [role]);
}
async function mkNanny(name: string, user: CurrentUser) {
  const [n] = await db.insert(s.nannies).values({ userId: user.id, displayName: name, slug: name.toLowerCase(), status: "approved", published: true, services: ["holiday"], languages: ["English"], ageGroups: ["preschool", "school"], areas: ["Atlantic Seaboard"], yearsExperience: 5 }).returning();
  await db.insert(s.verificationChecks).values(["interview", "reference", "identity", "police_clearance", "first_aid"].map((kind) => ({ nannyId: n.id, kind: kind as never, status: "passed" as const, expiresOn: "2099-01-01" })));
  return n.id;
}
async function mkFamily(user: CurrentUser) {
  const [f] = await db.insert(s.families).values({ displayName: `${user.name} household` }).returning();
  await db.insert(s.familyMembers).values({ familyId: f.id, userId: user.id, isPrimary: true });
  const [c] = await db.insert(s.children).values({ familyId: f.id, preferredName: "Kid", dateOfBirth: "2020-01-01", allergies: "Peanuts" }).returning();
  return { f: f.id, c: c.id };
}
const request = (u: CurrentUser, familyId: string, childId: string, start: number, end: number, key = randomUUID()) => createBookingRequest(u, {
  familyId, serviceCode: "holiday", startDate: day(start), endDate: day(end), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childId], requestedNannyId: null,
  liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: key, termsAccepted: true,
});
async function toAwaitingApproval(bookingId: string, nanny: string) {
  await runMatching(manager, bookingId);
  await assignNanny(manager, bookingId, nanny);
  await respondToOffer(nanny === nannyId ? nannyU : otherNannyU, bookingId, true);
  const q = await createQuotation(manager, bookingId, { adjustmentMinor: 0, adjustmentReason: null, travelTrips: 0, validDays: 7 });
  await sendQuotation(manager, q.id);
  return q;
}

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, families, nannies, bookings, service_categories, price_books, public_holidays, notifications, audit_events, payment_events, rate_limits, consents RESTART IDENTITY CASCADE`);
  await db.insert(s.serviceCategories).values(SERVICES);
  const [pb] = await db.insert(s.priceBooks).values({ version: 1, label: "test", status: "published", effectiveFrom: new Date(Date.now() - 86400_000) }).returning();
  await db.insert(s.priceItems).values(PRICE_ITEMS_V1.map((i) => ({ ...i, priceBookId: pb.id })));
  manager = await mkUser("manager@test.local", "manager");
  famA = await mkUser("a@test.local", "family");
  famB = await mkUser("b@test.local", "family");
  nannyU = await mkUser("n@test.local", "nanny");
  otherNannyU = await mkUser("n2@test.local", "nanny");
  ({ f: familyA, c: childA } = await mkFamily(famA));
  ({ f: familyB, c: childB } = await mkFamily(famB));
  nannyId = await mkNanny("Nia", nannyU);
  otherNannyId = await mkNanny("Zoe", otherNannyU);
});

describe("end-to-end booking workflow (service layer, real Postgres)", () => {
  it("request → match → quote → accept → verified payment → confirmed", async () => {
    const key = randomUUID();
    const b = await request(famA, familyA, childA, 10, 12, key);
    expect(b.status).toBe("enquiry");
    expect((await request(famA, familyA, childA, 10, 12, key)).id).toBe(b.id); // idempotent

    const q = await toAwaitingApproval(b.id, nannyId);
    expect(q.totalMinor).toBe(3 * 220000);
    expect(q.depositMinor).toBe(198000);

    // Nanny sees the booking pre-confirmation but not sensitive details
    const [pre] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.id));
    expect(await bookingAccess(nannyU, pre)).toMatchObject({ level: "nanny", sensitive: false, preciseLocation: false });

    await acceptQuotation(famA, q.id, true);
    const [held] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.id));
    expect(held.status).toBe("awaiting_payment"); // accepted ≠ confirmed

    const [deposit] = await db.select().from(s.invoices).where(and(eq(s.invoices.bookingId, b.id), eq(s.invoices.kind, "deposit")));
    process.env.DEMO_MODE = "false";
    const { paymentId, provider } = await startPayment(famA, deposit.id);
    expect(provider).toBe("payfast");
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
    expect(p.amountMinor).toBe(198000); // server-side amount

    // Tampered amount is rejected and does not confirm
    expect(await applyPaymentEvent({ provider: "payfast", eventId: "pf-1:COMPLETE-bad", paymentId, status: "succeeded", amountMinor: 100, payload: {} })).toBe("amount_mismatch");
    expect((await db.select().from(s.bookings).where(eq(s.bookings.id, b.id)))[0].status).toBe("awaiting_payment");
  });

  it("applies a verified payment exactly once, ignoring replays and late failures", async () => {
    const b = await request(famA, familyA, childA, 20, 20);
    const q = await toAwaitingApproval(b.id, nannyId);
    await acceptQuotation(famA, q.id, true);
    const [inv] = await db.select().from(s.invoices).where(and(eq(s.invoices.bookingId, b.id), eq(s.invoices.kind, "deposit")));
    const { paymentId } = await startPayment(famA, inv.id);
    const ev = { provider: "payfast", eventId: "pf-2:COMPLETE", paymentId, status: "succeeded" as const, amountMinor: inv.amountMinor, payload: {} };
    expect(await applyPaymentEvent(ev)).toBe("applied");
    expect(await applyPaymentEvent(ev)).toBe("duplicate");
    expect(await applyPaymentEvent({ ...ev, eventId: "pf-2:FAILED", status: "failed" })).toBe("already_applied");
    const [conf] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.id));
    expect(conf.status).toBe("confirmed");
    const [paidInv] = await db.select().from(s.invoices).where(eq(s.invoices.id, inv.id));
    expect(paidInv.paidMinor).toBe(inv.amountMinor);
    expect(await bookingAccess(nannyU, conf)).toMatchObject({ level: "nanny", sensitive: true });
    const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.bookingId, b.id));
    expect(conv).toBeTruthy();
    const nannyNotes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, nannyU.id), eq(s.notifications.template, "booking_confirmed_nanny")));
    expect(nannyNotes.length).toBeGreaterThan(0);
    // Publishing new prices never changes the accepted quotation
    await db.update(s.priceItems).set({ amount: 999900 }).where(eq(s.priceItems.code, "daily"));
    const [aq] = await db.select().from(s.quotations).where(eq(s.quotations.id, q.id));
    expect(aq.totalMinor).toBe(q.totalMinor);
    await db.update(s.priceItems).set({ amount: 220000 }).where(eq(s.priceItems.code, "daily"));
  });

  it("prevents two families from holding the same nanny for overlapping dates", async () => {
    const a = await request(famA, familyA, childA, 40, 42);
    const bb = await request(famB, familyB, childB, 41, 43);
    const qa = await toAwaitingApproval(a.id, nannyId);
    const qb = await toAwaitingApproval(bb.id, nannyId); // allowed: not yet held
    await acceptQuotation(famA, qa.id, true);
    await expect(acceptQuotation(famB, qb.id, true)).rejects.toBeInstanceOf(ConflictError);
    const [stillB] = await db.select().from(s.bookings).where(eq(s.bookings.id, bb.id));
    expect(stillB.status).toBe("awaiting_approval");
    // Matching now reports the conflict as a hard fail
    const res = await runMatching(manager, bb.id);
    expect(res.find((r) => r.nannyId === nannyId)?.eligible).toBe(false);
    expect(res.find((r) => r.nannyId === otherNannyId)?.eligible).toBe(true);
  });

  it("enforces the exclusion constraint at the database level", async () => {
    const b = await request(famB, familyB, childB, 60, 60);
    const t = new Date(day(60) + "T08:00:00Z");
    await db.insert(s.bookingSessions).values({ bookingId: b.id, nannyId: otherNannyId, startsAt: t, endsAt: new Date(t.getTime() + 3600_000), blocking: true });
    await expect(db.insert(s.bookingSessions).values({ bookingId: b.id, nannyId: otherNannyId, startsAt: new Date(t.getTime() + 1800_000), endsAt: new Date(t.getTime() + 7200_000), blocking: true })).rejects.toMatchObject({ cause: { code: "23P01" } });
  });
});

describe("authorisation (direct service calls, not UI)", () => {
  it("denies cross-family access and actions", async () => {
    const b = await request(famA, familyA, childA, 80, 80);
    expect((await bookingAccess(famB, b)).level).toBe("none");
    expect((await bookingAccess(otherNannyU, b)).level).toBe("none");
    await expect(transition(famB, b.id, "cancelled")).rejects.toBeInstanceOf(DomainError);
    await expect(createBookingRequest(famB, { familyId: familyA, serviceCode: "holiday", startDate: day(5), endDate: day(5), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childA], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: true })).rejects.toThrow(/not authorised/);
    await expect(request(famA, familyA, childB, 5, 5)).rejects.toThrow(/Invalid child/);
  });
  it("blocks role escalation and invalid transitions", async () => {
    const b = await request(famA, familyA, childA, 90, 90);
    await expect(runMatching(famA, b.id)).rejects.toThrow(/permission/);
    await expect(transition(famA, b.id, "confirmed")).rejects.toThrow(/cannot move/);
    await expect(transition(manager, b.id, "completed")).rejects.toThrow(/cannot move/);
    const ops = await mkUser("ops@test.local", "ops");
    await expect(assignNanny(ops, b.id, nannyId)).rejects.toThrow(/permission/);
  });
  it("rejects past dates and missing consent", async () => {
    await expect(request(famA, familyA, childA, -3, -2)).rejects.toThrow(/future/);
    await expect(createBookingRequest(famA, { familyId: familyA, serviceCode: "holiday", startDate: day(5), endDate: day(5), dailyStartMinute: 540, dailyEndMinute: 1020, serviceLocationId: null, childIds: [childA], requestedNannyId: null, liveIn: false, overnight: false, needsDriver: false, requiredLanguages: [], specialistCare: false, budgetMaxMinor: null, specialRequests: null, idempotencyKey: randomUUID(), termsAccepted: false })).rejects.toThrow(/terms/);
  });
});

describe("notifications", () => {
  it("deduplicates per user, channel and event key", async () => {
    await notify(famA.id, "support_update", { subject: "x", status: "open" }, "dedupe-test");
    await notify(famA.id, "support_update", { subject: "x", status: "open" }, "dedupe-test");
    const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, famA.id), eq(s.notifications.dedupeKey, "dedupe-test")));
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app"]);
  });
});
