/**
 * Demo environment seed. Synthetic people only — no real nannies, families or children.
 * Refuses to run unless DEMO_MODE=true and the database contains no non-demo users.
 *   DEMO_MODE=true npm run db:seed:demo
 */
import { sql } from "drizzle-orm";
import { db, pool, schema as s } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import { buildSessions } from "../src/lib/time";
import { bootstrapReference } from "./bootstrap";

if (process.env.DEMO_MODE !== "true") { console.error("Refusing: DEMO_MODE must be true."); process.exit(1); }
const real = await db.execute(sql`SELECT count(*)::int AS c FROM users WHERE is_demo = false`);
if (Number(real.rows[0].c) > 0) { console.error("Refusing: database contains non-demo users."); process.exit(1); }

// Wipe previous demo data (demo DB only).
await db.execute(sql`TRUNCATE users, families, nannies, bookings, service_categories, price_books, public_holidays, faq_articles, notifications, audit_events, payment_events, rate_limits, consents, support_requests, integration_configs, settings, documents RESTART IDENTITY CASCADE`);
await bootstrapReference({ publishPriceBook: true });

const pw = await hashPassword("OmegaDemo2026!");
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
async function user(email: string, name: string, role: "family" | "nanny" | "ops" | "manager" | "admin", permissions: string[] = []) {
  const [u] = await db.insert(s.users).values({ email, name, passwordHash: pw, status: "active", emailVerifiedAt: new Date(), isDemo: true, permissions }).returning();
  await db.insert(s.userRoles).values({ userId: u.id, role });
  return u;
}

const admin = await user("admin.demo@example.com", "Alex Admin (Demo)", "admin");
const manager = await user("manager.demo@example.com", "Morgan Manager (Demo)", "manager");
await user("ops.demo@example.com", "Olivia Ops (Demo)", "ops", ["bookings.manage"]);

// ---- Nannies (synthetic) ----
type N = { name: string; email?: string; status: "approved" | "onboarding"; services: string[]; langs: string[]; ages: string[]; areas: string[]; years: number; drive: boolean; headline: string; bio: string; skills: string[]; specialist?: string; firstAidExpiry?: string };
const NANNIES: N[] = [
  { name: "Amahle N.", email: "nanny.demo@example.com", status: "approved", services: ["holiday", "event", "night"], langs: ["English", "isiXhosa"], ages: ["toddler", "preschool", "school"], areas: ["Atlantic Seaboard", "City Bowl & Waterfront"], years: 8, drive: true, headline: "Beach days, bedtime stories and calm, happy routines.", bio: "A former Grade R assistant with eight years in private childcare, Amahle builds trust quickly and keeps little ones busy with outdoor play, crafts and swimming supervision.", skills: ["Swimming supervision", "Outdoor play", "Arts & crafts"], firstAidExpiry: day(20) },
  { name: "Lerato M.", email: "nanny2.demo@example.com", status: "approved", services: ["live_in", "holiday", "special_needs"], langs: ["English", "Afrikaans"], ages: ["newborn", "toddler", "preschool", "school"], areas: ["Southern Suburbs", "Cape Winelands"], years: 12, drive: true, headline: "Twelve years of live-in care for travelling families.", bio: "Lerato has travelled with families across the Western Cape and on safari. She is trained in Montessori principles and has supported children with autism and ADHD.", skills: ["Montessori approach", "Travel experience", "Sleep routines"], specialist: "Autism and ADHD support; sensory-friendly routines." },
  { name: "Charlotte B.", status: "approved", services: ["holiday", "event"], langs: ["English", "French", "German"], ages: ["preschool", "school", "teen"], areas: ["Atlantic Seaboard", "Cape Winelands"], years: 5, drive: false, headline: "Trilingual, sporty and endlessly curious.", bio: "Charlotte grew up between Lyon and Cape Town and loves hiking, tennis and homework help in three languages.", skills: ["Homework support", "Outdoor play"] },
  { name: "Thandi K.", email: "nanny3.demo@example.com", status: "approved", services: ["night", "holiday"], langs: ["English", "isiXhosa"], ages: ["newborn", "toddler"], areas: ["Southern Suburbs", "City Bowl & Waterfront"], years: 10, drive: true, headline: "Newborn and night-time specialist.", bio: "Thandi supports new parents with feeds, settling and gentle sleep routines so everyone gets some rest.", skills: ["Newborn care", "Sleep routines"] },
  { name: "Marguerite V.", status: "approved", services: ["granny", "holiday"], langs: ["English", "Afrikaans", "Dutch"], ages: ["toddler", "preschool", "school"], areas: ["Cape Winelands", "Garden Route"], years: 30, drive: true, headline: "A grandmother's warmth with a professional's standards.", bio: "Mother of three and grandmother of five, Marguerite brings baking, gardening and storytelling to every family.", skills: ["Meal preparation", "Arts & crafts"] },
  { name: "Johanna S.", status: "onboarding", services: ["holiday"], langs: ["English"], ages: ["school"], areas: ["Garden Route"], years: 3, drive: false, headline: "Newly invited — vetting in progress.", bio: "Profile under review.", skills: [] },
];
const nannyRows: Record<string, typeof s.nannies.$inferSelect> = {};
for (const n of NANNIES) {
  const u = n.email ? await user(n.email, n.name.replace(".", "") + " (Demo)", "nanny") : null;
  const [row] = await db.insert(s.nannies).values({
    userId: u?.id, displayName: n.name, slug: n.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, ""), status: n.status, published: n.status === "approved",
    headline: n.headline, bio: n.bio, yearsExperience: n.years, services: n.services, languages: n.langs, ageGroups: n.ages, areas: n.areas, canDrive: n.drive, hasOwnCar: n.drive,
    skills: n.skills, specialistExperience: n.specialist ?? null, isDemo: true, internalNotes: "Synthetic demo profile.",
  }).returning();
  nannyRows[n.name] = row;
  await db.insert(s.qualifications).values([{ nannyId: row.id, name: "Paediatric First Aid (Level 1)", issuer: "St John (Demo)", verified: n.status === "approved", expiresOn: n.firstAidExpiry ?? day(400) }]);
  if (n.status === "approved") {
    await db.insert(s.verificationChecks).values((["interview", "reference", "identity", "police_clearance", "first_aid"] as const).map((kind) => ({
      nannyId: row.id, kind, status: "passed" as const, completedOn: day(-90), expiresOn: kind === "first_aid" ? (n.firstAidExpiry ?? day(400)) : kind === "police_clearance" ? day(275) : null, recordedBy: manager.id, notes: "Demo record",
    })));
    const rules = n.services.includes("live_in") ? [0, 1, 2, 3, 4, 5, 6].map((w) => ({ nannyId: row.id, weekday: w, startMinute: 0, endMinute: 1439 }))
      : [1, 2, 3, 4, 5, 6, 0].map((w) => ({ nannyId: row.id, weekday: w, startMinute: n.services.includes("night") ? 360 : 420, endMinute: n.services.includes("night") ? 1439 : 1200 }));
    await db.insert(s.availabilityRules).values(rules);
  } else {
    await db.insert(s.verificationChecks).values([{ nannyId: row.id, kind: "interview", status: "passed", completedOn: day(-5), recordedBy: manager.id }, { nannyId: row.id, kind: "police_clearance", status: "pending" }]);
  }
}
await db.insert(s.availabilityExceptions).values({ nannyId: nannyRows["Charlotte B."].id, startsAt: new Date(day(30) + "T00:00:00Z"), endsAt: new Date(day(37) + "T00:00:00Z"), kind: "leave", reason: "Annual leave" });

// ---- Families (synthetic) ----
async function family(email: string, name: string, household: string, audience: string, country: string) {
  const u = await user(email, name, "family");
  const [f] = await db.insert(s.families).values({ displayName: household, audience, countryOfResidence: country, billingName: name, billingEmail: email, emergencyContactName: "Sam (Demo)", emergencyContactPhone: "+44 7700 900123", preferredChannel: "whatsapp", bookingPreferences: "Prefers a nanny who can drive and swim.", isDemo: true }).returning();
  await db.insert(s.familyMembers).values({ familyId: f.id, userId: u.id, isPrimary: true });
  await db.insert(s.consents).values({ userId: u.id, policy: "privacy", version: "2026-10", granted: true });
  return { u, f };
}
const w = await family("family.demo@example.com", "Harriet Whitfield (Demo)", "The Whitfield family (Demo)", "visiting", "United Kingdom");
const v = await family("family2.demo@example.com", "Pieter van der Berg (Demo)", "Van der Berg household (Demo)", "visiting", "Netherlands");
const [wLoc] = await db.insert(s.serviceLocations).values({ familyId: w.f.id, label: "Holiday villa", area: "Atlantic Seaboard", addressLine: "12 Example Crescent, Camps Bay (synthetic)", accessNotes: "Gate code shared on confirmation." }).returning();
const [vLoc] = await db.insert(s.serviceLocations).values({ familyId: v.f.id, label: "Apartment", area: "City Bowl & Waterfront", addressLine: "Unit 4, 1 Sample Road, Waterfront (synthetic)" }).returning();
const kids = await db.insert(s.children).values([
  { familyId: w.f.id, preferredName: "Olly", dateOfBirth: "2021-04-12", allergies: "Peanuts (carries EpiPen)", routines: "Nap 13:00–14:30", interests: "Dinosaurs, swimming", emergencyInstructions: "EpiPen in blue bag; call parents then 10177.", consentRecordedAt: new Date() },
  { familyId: w.f.id, preferredName: "Bea", dateOfBirth: "2018-09-03", dietaryNeeds: "Vegetarian", interests: "Drawing, tennis", consentRecordedAt: new Date() },
  { familyId: v.f.id, preferredName: "Noor", dateOfBirth: "2026-05-20", routines: "Feeds every 3 hours overnight", consentRecordedAt: new Date() },
]).returning();
await db.insert(s.favourites).values([{ familyId: w.f.id, nannyId: nannyRows["Amahle N."].id }, { familyId: w.f.id, nannyId: nannyRows["Charlotte B."].id }]);

// ---- Bookings across the lifecycle ----
const [pb] = await db.select().from(s.priceBooks).limit(1);
let refN = 100;
async function booking(o: { fam?: typeof w; nanny?: string; service: string; start: string; end: string; from: number; to: number; status: typeof s.bookings.$inferInsert.status; loc?: string; kidIdx?: number[]; liveIn?: boolean; quote?: { total: number; deposit: number; lines: unknown[]; status: string }; paid?: ("deposit" | "balance")[]; enquiry?: Partial<typeof s.bookings.$inferInsert> }) {
  const nannyId = o.nanny ? nannyRows[o.nanny].id : null;
  const [b] = await db.insert(s.bookings).values({
    reference: `ON-DEMO-${refN++}`, familyId: o.fam?.f.id ?? null, nannyId, serviceCode: o.service, status: o.status, startDate: o.start, endDate: o.end,
    dailyStartMinute: o.from, dailyEndMinute: o.to, serviceLocationId: o.loc ?? null, liveIn: !!o.liveIn, isDemo: true, createdBy: o.fam?.u.id ?? null,
    source: o.enquiry ? "website" : "portal", termsAcceptedAt: o.fam ? new Date() : null, termsVersion: o.fam ? "2026-10" : null, ...o.enquiry,
  }).returning();
  if (o.kidIdx) await db.insert(s.bookingChildren).values(o.kidIdx.map((i) => ({ bookingId: b.id, childId: kids[i].id })));
  const blocking = ["awaiting_payment", "confirmed", "in_progress"].includes(o.status!);
  await db.insert(s.bookingSessions).values(buildSessions({ startDate: o.start, endDate: o.end, dailyStartMinute: o.from, dailyEndMinute: o.to, timeZone: "Africa/Johannesburg", liveIn: o.liveIn }).map((x) => ({ bookingId: b.id, nannyId, startsAt: x.startsAt, endsAt: x.endsAt, blocking })));
  await db.insert(s.bookingEvents).values({ bookingId: b.id, toStatus: "enquiry", kind: "status", note: "Request submitted", actorId: o.fam?.u.id ?? null, createdAt: new Date(Date.now() - 6 * 86400_000) });
  if (o.status !== "enquiry") await db.insert(s.bookingEvents).values({ bookingId: b.id, fromStatus: "enquiry", toStatus: o.status, kind: "status", note: "Demo history", actorId: manager.id });
  if (o.quote) {
    const [q] = await db.insert(s.quotations).values({ bookingId: b.id, version: 1, priceBookId: pb.id, lines: o.quote.lines, subtotalMinor: o.quote.total, totalMinor: o.quote.total, depositMinor: o.quote.deposit, status: o.quote.status, sentAt: new Date(), validUntil: new Date(Date.now() + 7 * 86400_000), acceptedAt: o.quote.status === "accepted" ? new Date() : null, acceptedBy: o.quote.status === "accepted" ? o.fam?.u.id : null, createdBy: manager.id }).returning();
    if (o.quote.status === "accepted") {
      await db.update(s.bookings).set({ acceptedQuotationId: q.id }).where(sql`id = ${b.id}`);
      const invs = await db.insert(s.invoices).values([
        { number: `${b.reference}-D1`, bookingId: b.id, quotationId: q.id, kind: "deposit", currency: "ZAR", amountMinor: q.depositMinor, paidMinor: o.paid?.includes("deposit") ? q.depositMinor : 0, status: o.paid?.includes("deposit") ? "paid" : "open" },
        { number: `${b.reference}-B1`, bookingId: b.id, quotationId: q.id, kind: "balance", currency: "ZAR", amountMinor: q.totalMinor - q.depositMinor, paidMinor: o.paid?.includes("balance") ? q.totalMinor - q.depositMinor : 0, status: o.paid?.includes("balance") ? "paid" : "open" },
      ]).returning();
      for (const inv of invs.filter((i) => i.status === "paid")) await db.insert(s.payments).values({ invoiceId: inv.id, provider: "demo", providerRef: `demo-${inv.number}`, amountMinor: inv.amountMinor, currency: "ZAR", status: "succeeded", confirmedAt: new Date() });
    }
  }
  return b;
}
const line = (label: string, qty: string, unit: number, n: number) => ({ label, qty, unitMinor: unit, totalMinor: unit * n });
const done = await booking({ fam: w, nanny: "Amahle N.", service: "holiday", start: day(-19), end: day(-17), from: 540, to: 1020, status: "completed", loc: wLoc.id, kidIdx: [0, 1], quote: { total: 660000, deposit: 198000, lines: [line("Daily care", "3 days", 220000, 3)], status: "accepted" }, paid: ["deposit", "balance"] });
await db.insert(s.reviews).values({ bookingId: done.id, familyId: w.f.id, nannyId: nannyRows["Amahle N."].id, rating: 5, body: "Amahle was wonderful with both children — Olly still talks about the rock pools. We'll book again in December.", status: "published" });
const upcoming = await booking({ fam: w, nanny: "Amahle N.", service: "holiday", start: day(50), end: day(56), from: 480, to: 1080, status: "confirmed", loc: wLoc.id, kidIdx: [0, 1], quote: { total: 1540000, deposit: 462000, lines: [line("Daily care", "7 days", 220000, 7)], status: "accepted" }, paid: ["deposit"] });
await booking({ fam: w, nanny: "Lerato M.", service: "live_in", start: day(68), end: day(74), from: 480, to: 480, liveIn: true, status: "awaiting_approval", loc: wLoc.id, kidIdx: [0, 1], quote: { total: 1890000, deposit: 567000, lines: [line("Live-in care (weekly rate, per day)", "7 days", 270000, 7)], status: "sent" } });
await booking({ fam: v, nanny: "Thandi K.", service: "night", start: day(-2), end: day(2), from: 1200, to: 360, status: "in_progress", loc: vLoc.id, kidIdx: [2], quote: { total: 990000, deposit: 297000, lines: [line("Night care", "5 nights", 198000, 5)], status: "accepted" }, paid: ["deposit", "balance"] });
await booking({ fam: v, service: "holiday", start: day(16), end: day(18), from: 540, to: 1020, status: "matching", loc: vLoc.id, kidIdx: [2] });
await booking({ service: "event", start: day(23), end: day(23), from: 900, to: 1380, status: "enquiry", enquiry: { enquiryName: "Chidi Okafor (Demo)", enquiryEmail: "okafor.demo@example.com", enquiryPhone: "+234 800 000 0000", enquiryChildren: "3 children: 2, 5, 9", areaText: "Cape Winelands", specialRequests: "Wedding in Franschhoek — need two nannies for the reception." } });

// ---- Messages ----
const [conv] = await db.insert(s.conversations).values({ kind: "family_management", familyId: w.f.id, subject: "Questions about December", lastMessageAt: new Date() }).returning();
await db.insert(s.conversationParticipants).values([{ conversationId: conv.id, userId: w.u.id, lastReadAt: new Date() }, { conversationId: conv.id, userId: manager.id }]);
await db.insert(s.messages).values([
  { conversationId: conv.id, senderId: w.u.id, body: "Hi! Could Amahle join us for a day trip to Cape Point during the December booking?", createdAt: new Date(Date.now() - 3600_000 * 5) },
  { conversationId: conv.id, senderId: manager.id, body: "Of course — day trips are fine. We'll add a travel note to the booking so Amahle can plan.", createdAt: new Date(Date.now() - 3600_000 * 4) },
]);
const nannyU = (await db.select().from(s.users).where(sql`email = 'nanny.demo@example.com'`))[0];
const [bconv] = await db.insert(s.conversations).values({ kind: "booking", bookingId: upcoming.id, familyId: w.f.id, nannyId: nannyRows["Amahle N."].id, subject: `Booking ${upcoming.reference}`, lastMessageAt: new Date() }).returning();
await db.insert(s.conversationParticipants).values([{ conversationId: bconv.id, userId: w.u.id }, { conversationId: bconv.id, userId: nannyU.id }]);
await db.insert(s.messages).values({ conversationId: bconv.id, senderId: nannyU.id, body: "Hello Whitfields! Looking forward to December. Does Bea still have tennis on Tuesdays?" });
await db.insert(s.supportRequests).values({ userId: v.u.id, subject: "Invoice address", body: "Please add our company name to the invoice.", category: "billing" });
await db.insert(s.notifications).values([
  { userId: w.u.id, dedupeKey: "seed:quote", channel: "in_app", template: "quote_ready", subject: "Your live-in quotation is ready", body: "Review and accept your quotation to hold Lerato's dates.", status: "sent", link: "/family/bookings" },
  { userId: nannyU.id, dedupeKey: "seed:doc", channel: "in_app", template: "document_expiring", subject: "First Aid certificate expires soon", body: "Please upload a renewed certificate.", status: "sent", link: "/nanny/documents" },
]);
console.log("Demo data seeded. Password for all demo accounts: OmegaDemo2026!");
await pool.end();
void admin;
