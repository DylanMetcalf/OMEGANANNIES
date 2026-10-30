import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { acceptQuotation, assignNanny, ConflictError, createBookingRequest, createQuotation, DomainError, reschedule, respondToOffer, runMatching, sendQuotation, transition } from "@/lib/bookings";
import { applyPaymentEvent, startPayment } from "@/lib/payments/service";
import { importWebsiteNannies, parseCsv } from "@/lib/website-import";
import { notify } from "@/lib/notify";
import { PRICE_ITEMS_V1, SERVICES } from "@/db/seed/reference";
import type { CurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/permissions";

/** Audit 4: operational edge cases — retries, re-imports, outages, reschedules and cancellations. */
const day = (o: number) => new Date(Date.now() + o * 86400_000).toISOString().slice(0, 10);
const cu = (u: typeof s.users.$inferSelect, roles: Role[]): CurrentUser => ({ id: u.id, email: u.email, name: u.name, roles, permissions: u.permissions, status: "active", mfaEnabled: false, mfaPassed: true, isDemo: false, sessionId: "test" });
let admin: CurrentUser, famA: CurrentUser, famB: CurrentUser, nanny1U: CurrentUser;
let familyA: string, familyB: string, childA: string, childB: string, nanny1: string;
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


const card = (o: object) => `<div data-nanny='${JSON.stringify(o).replace(/'/g, "&#39;")}'></div>`;
const PAGE = card({ name: "Thandi M", photo: "/storage/images/thandi.jpg", bio: "Loves outdoor play.", experience: "6 years", languages: "English, isiXhosa", ageGroups: "Toddlers, School age" }) + card({ name: "Anna K", bio: "Former teacher.", experience: "10 years", languages: "English" });
const noPhoto: typeof fetch = async () => { throw new Error("photo host down"); };

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, families, nannies, bookings, service_categories, price_books, public_holidays, notifications, audit_events, payment_events, rate_limits, consents, settings, tasks, integration_configs RESTART IDENTITY CASCADE`);
  await db.insert(s.serviceCategories).values(SERVICES);
  const [pb] = await db.insert(s.priceBooks).values({ version: 1, label: "test", status: "published", effectiveFrom: new Date(Date.now() - 86400_000) }).returning();
  await db.insert(s.priceItems).values(PRICE_ITEMS_V1.map((i) => ({ ...i, priceBookId: pb.id })));
  admin = await mkUser("admin@ops.test", "admin");
  famA = await mkUser("a@ops.test", "family"); famB = await mkUser("b@ops.test", "family");
  nanny1U = await mkUser("n1@ops.test", "nanny");
  ({ f: familyA, c: childA } = await mkFamily(famA)); ({ f: familyB, c: childB } = await mkFamily(famB));
  nanny1 = await mkNanny("One", nanny1U);
});

describe("website import", () => {
  it("creates unpublished drafts, tolerates photo failures and is idempotent", async () => {
    const r1 = await importWebsiteNannies(admin.id, { html: PAGE, fetchImpl: noPhoto });
    expect(r1).toMatchObject({ found: 2, created: 2, updated: 0, photos: 0 });
    expect(r1.errors.some((e) => e.includes("photo"))).toBe(true);
    const rows = await db.select().from(s.nannies).where(eq(s.nannies.importSource, "website"));
    expect(rows.every((n) => n.status === "draft" && !n.published && !n.userId)).toBe(true);
    const r2 = await importWebsiteNannies(admin.id, { html: PAGE, fetchImpl: noPhoto });
    expect(r2).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect((await db.select().from(s.nannies).where(eq(s.nannies.importSource, "website"))).length).toBe(2);
  });

  it("never overwrites fields edited by Omega or verified", async () => {
    const [t] = await db.select().from(s.nannies).where(and(eq(s.nannies.importSource, "website"), sql`${s.nannies.displayName} like 'Thandi%'`));
    const p = t.provenance as Record<string, object>;
    await db.update(s.nannies).set({ bio: "Edited by Omega", yearsExperience: 7, provenance: { ...p, bio: { source: "admin", verified: false }, yearsExperience: { source: "website", verified: true } } }).where(eq(s.nannies.id, t.id));
    const changed = PAGE.replace("Loves outdoor play.", "New website bio").replace("6 years", "8 years");
    const r = await importWebsiteNannies(admin.id, { html: changed, fetchImpl: noPhoto });
    expect(r.skippedFields).toBeGreaterThanOrEqual(2);
    const [after] = await db.select().from(s.nannies).where(eq(s.nannies.id, t.id));
    expect(after.bio).toBe("Edited by Omega");
    expect(after.yearsExperience).toBe(7);
  });

  it("reports an unreachable website without recording an empty import", async () => {
    const down: typeof fetch = async () => new Response("Bad gateway", { status: 502 });
    await expect(importWebsiteNannies(admin.id, { fetchImpl: down })).rejects.toThrow(/could not be reached \(HTTP 502\)/);
    const offline: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    await expect(importWebsiteNannies(admin.id, { fetchImpl: offline })).rejects.toBeInstanceOf(DomainError);
    await expect(importWebsiteNannies(admin.id, { html: "<html>redesigned page</html>" })).rejects.toThrow(/No nanny profiles/);
    const [cfg] = await db.select().from(s.integrationConfigs).where(eq(s.integrationConfigs.key, "website"));
    expect((cfg.settings as { lastImport: { found: number } }).lastImport.found).toBe(2);
  });

  it("parses CSV with quoted commas and blank lines", () => {
    const rows = parseCsv('name,email,bio\n"Lebo N",lebo@example.test,"Calm, kind and patient"\n\n');
    expect(rows).toEqual([{ name: "Lebo N", email: "lebo@example.test", bio: "Calm, kind and patient" }]);
  });
});

describe("notifications", () => {
  it("deduplicates retried sends", async () => {
    for (let i = 0; i < 3; i++) await notify(famA.id, "payment_received", { ref: "OMG-1", amount: "R1" }, "dedupe:test");
    const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, famA.id), eq(s.notifications.dedupeKey, "dedupe:test"), eq(s.notifications.channel, "in_app")));
    expect(rows.length).toBe(1);
  });
});

describe("schedule changes", () => {
  it("refuses a reschedule into the nanny's other booking", async () => {
    const a = await quoted(famA, familyA, childA, nanny1, nanny1U, 300);
    await acceptQuotation(famA, a.q.id, true);
    const b = await quoted(famB, familyB, childB, nanny1, nanny1U, 302);
    await acceptQuotation(famB, b.q.id, true);
    await expect(reschedule(admin, b.b.id, { startDate: day(300), endDate: day(300), dailyStartMinute: 600, dailyEndMinute: 700, reason: "family asked" })).rejects.toBeInstanceOf(ConflictError);
    const [still] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.b.id));
    expect(still.startDate).toBe(day(302)); // unchanged after the failed attempt
  });

  it("frees the nanny when a held booking is cancelled", async () => {
    const a = await quoted(famA, familyA, childA, nanny1, nanny1U, 320);
    const b = await quoted(famB, familyB, childB, nanny1, nanny1U, 320);
    await acceptQuotation(famA, a.q.id, true);
    await expect(acceptQuotation(famB, b.q.id, true)).rejects.toBeInstanceOf(ConflictError);
    await transition(famA, a.b.id, "cancelled", "Plans changed");
    await acceptQuotation(famB, b.q.id, true);
    expect((await db.select().from(s.bookings).where(eq(s.bookings.id, b.b.id)))[0].status).toBe("awaiting_payment");
  });
});

describe("payment retries", () => {
  it("reuses an open attempt and flags a genuine duplicate for refund", async () => {
    const { b, q } = await quoted(famA, familyA, childA, nanny1, nanny1U, 340);
    await acceptQuotation(famA, q.id, true);
    const [inv] = await db.select().from(s.invoices).where(and(eq(s.invoices.bookingId, b.id), eq(s.invoices.kind, "deposit")));
    process.env.DEMO_MODE = "false";
    const first = await startPayment(famA, inv.id);
    expect((await startPayment(famA, inv.id)).paymentId).toBe(first.paymentId); // second tab / double click
    // A second attempt still exists (e.g. created before the first expired) and both succeed at the provider.
    const [second] = await db.insert(s.payments).values({ invoiceId: inv.id, provider: "payfast", amountMinor: inv.amountMinor, currency: inv.currency, initiatedBy: famA.id }).returning();
    expect(await applyPaymentEvent({ provider: "payfast", eventId: "dup-1", paymentId: first.paymentId, status: "succeeded", amountMinor: inv.amountMinor, payload: {} })).toBe("applied");
    expect(await applyPaymentEvent({ provider: "payfast", eventId: "dup-2", paymentId: second.id, status: "succeeded", amountMinor: inv.amountMinor, payload: {} })).toBe("duplicate_payment_refund_needed");
    const [after] = await db.select().from(s.invoices).where(eq(s.invoices.id, inv.id));
    expect(after.paidMinor).toBe(inv.amountMinor); // not double-counted
    const tasks = await db.select().from(s.tasks).where(eq(s.tasks.bookingId, b.id));
    expect(tasks.some((t) => t.title.startsWith("Refund duplicate"))).toBe(true);
    await expect(startPayment(famA, inv.id)).rejects.toThrow(/not payable/);
  });
});

describe("maintenance job", () => {
  it("flags an unpaid hold once and rejects unauthenticated calls", async () => {
    const { GET } = await import("@/app/api/cron/daily/route");
    process.env.CRON_SECRET = "test-cron-secret";
    expect((await GET(new Request("http://x/api/cron/daily"))).status).toBe(401);
    const { b, q } = await quoted(famA, familyA, childA, nanny1, nanny1U, 360);
    await acceptQuotation(famA, q.id, true);
    await db.update(s.quotations).set({ acceptedAt: new Date(Date.now() - 72 * 3600_000) }).where(eq(s.quotations.id, q.id));
    const call = () => GET(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(((await (await call()).json()) as { unpaidHoldsFlagged: number }).unpaidHoldsFlagged).toBeGreaterThanOrEqual(1);
    await call(); // second run must not duplicate the task
    const t = await db.select().from(s.tasks).where(and(eq(s.tasks.bookingId, b.id), sql`${s.tasks.title} like 'Unpaid hold%'`));
    expect(t.length).toBe(1);
    expect((await db.select().from(s.bookings).where(eq(s.bookings.id, b.id)))[0].status).toBe("awaiting_payment"); // never auto-cancelled
  });
});
