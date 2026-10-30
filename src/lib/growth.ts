import "server-only";
import { randomInt } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "./audit";
import { can } from "./permissions";
import { getSetting } from "./settings";
import type { CurrentUser } from "./auth";
import { DomainError } from "./bookings";

/**
 * Referrals & loyalty. Both programmes ship switched OFF: attribution can be recorded, but nothing is ever awarded
 * until Omega enables a programme and sets its terms. Every balance change is an append-only ledger row created on
 * the server (never from client input), and a unique (family, reason, ref) makes each award happen at most once.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export async function ensureReferralCode(familyId: string, userId: string) {
  const [x] = await db.select().from(s.referralCodes).where(eq(s.referralCodes.familyId, familyId));
  if (x) return x;
  for (let i = 0; i < 5; i++) {
    const [c] = await db.insert(s.referralCodes).values({ code: newCode(), familyId, userId }).onConflictDoNothing().returning();
    if (c) return c;
    const [again] = await db.select().from(s.referralCodes).where(eq(s.referralCodes.familyId, familyId));
    if (again) return again;
  }
  throw new Error("Could not allocate a referral code");
}

const normEmail = (e: string) => { const [l, d] = e.toLowerCase().split("@"); return `${l.split("+")[0].replace(/\./g, "")}@${d}`; };
/** Record who referred a new family (at registration). Suspicious patterns are flagged for review, never auto-rewarded. */
export async function attributeReferral(code: string, referredUserId: string, referredFamilyId: string) {
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return null;
  const [c] = await db.select().from(s.referralCodes).where(and(eq(s.referralCodes.code, code), eq(s.referralCodes.active, true)));
  if (!c || c.familyId === referredFamilyId || c.userId === referredUserId) return null; // no self-referral
  const [[ref], [newU], [{ n: recent }]] = await Promise.all([
    db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, c.userId)),
    db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, referredUserId)),
    db.select({ n: count() }).from(s.referrals).where(and(eq(s.referrals.codeId, c.id), gt(s.referrals.createdAt, new Date(Date.now() - 86400_000)))),
  ]);
  const flags: string[] = [];
  if (ref && newU && normEmail(ref.email) === normEmail(newU.email)) flags.push("same_email");
  if (recent >= 5) flags.push("many_signups_24h");
  const [r] = await db.insert(s.referrals).values({ codeId: c.id, referredUserId, referredFamilyId, flags }).onConflictDoNothing().returning();
  if (r) await audit(referredUserId, "referral.attributed", "referral", r.id, { flags });
  return r ?? null;
}

export async function balances(familyId: string) {
  const rows = await db.select({ kind: s.loyaltyLedger.kind, total: sql<number>`coalesce(sum(${s.loyaltyLedger.delta}),0)::int` }).from(s.loyaltyLedger).where(eq(s.loyaltyLedger.familyId, familyId)).groupBy(s.loyaltyLedger.kind);
  return { points: rows.find((r) => r.kind === "points")?.total ?? 0, creditMinor: rows.find((r) => r.kind === "credit_minor")?.total ?? 0 };
}
async function award(familyId: string, kind: "points" | "credit_minor", delta: number, reason: string, refId: string, note: string, by: string | null) {
  if (!delta) return false;
  const r = await db.insert(s.loyaltyLedger).values({ familyId, kind, delta, reason, refId, note, createdBy: by }).onConflictDoNothing().returning();
  return r.length > 0;
}

/** Booking hook: loyalty points on completion; referral qualification on the configured milestone. */
export async function onBookingForGrowth(bookingId: string, to: string) {
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId));
  if (!b?.familyId) return;
  const [loyalty, referral] = await Promise.all([getSetting("loyalty"), getSetting("referral")]);
  if (loyalty.enabled && b.status === "completed") {
    await award(b.familyId, "points", loyalty.pointsPerCompletedBooking, "booking_completed", b.id, `Completed ${b.reference}`, null);
    if (loyalty.milestoneEvery > 0 && loyalty.milestonePoints > 0) {
      const [{ n }] = await db.select({ n: count() }).from(s.bookings).where(and(eq(s.bookings.familyId, b.familyId), eq(s.bookings.status, "completed")));
      if (n % loyalty.milestoneEvery === 0) await award(b.familyId, "points", loyalty.milestonePoints, "milestone", `completed:${n}`, `${n} completed bookings`, null);
    }
  }
  const qualifies = referral.qualification === "first_completed_booking" ? b.status === "completed" : ["confirmed", "in_progress", "completed"].includes(b.status);
  if (!referral.enabled || !qualifies || (referral.services.length && !referral.services.includes(b.serviceCode))) return;
  const [r] = await db.select({ r: s.referrals, codeFamily: s.referralCodes.familyId }).from(s.referrals).innerJoin(s.referralCodes, eq(s.referralCodes.id, s.referrals.codeId)).where(and(eq(s.referrals.referredFamilyId, b.familyId), eq(s.referrals.status, "signed_up")));
  if (!r) return;
  if (Date.now() - r.r.createdAt.getTime() > referral.expiryDays * 86400_000) { await db.update(s.referrals).set({ status: "expired" }).where(eq(s.referrals.id, r.r.id)); return; }
  const [{ n: rewarded }] = await db.select({ n: count() }).from(s.referrals).where(and(eq(s.referrals.codeId, r.r.codeId), eq(s.referrals.status, "rewarded")));
  const flags = [...r.r.flags, ...(rewarded >= referral.maxRewardsPerReferrer ? ["over_reward_limit"] : [])];
  const needsReview = referral.requireApproval || flags.length > 0;
  await db.update(s.referrals).set({ status: needsReview ? "pending_approval" : "rewarded", qualifyingBookingId: b.id, flags, ...(needsReview ? {} : { decidedAt: new Date() }) }).where(and(eq(s.referrals.id, r.r.id), eq(s.referrals.status, "signed_up")));
  if (!needsReview) await award(r.codeFamily, referral.rewardType === "points" ? "points" : "credit_minor", referral.rewardValue, "referral_reward", r.r.id, "Referral reward", null);
  void to;
}

/** Management decision on a referral awaiting approval. Rewards use the programme terms in force now. */
export async function decideReferral(u: CurrentUser, referralId: string, approve: boolean) {
  if (!can(u, "payments.manage")) throw new DomainError("You don't have permission to approve rewards.");
  const referral = await getSetting("referral");
  if (approve && !referral.enabled) throw new DomainError("The referral programme is switched off.");
  const [r] = await db.select({ r: s.referrals, codeFamily: s.referralCodes.familyId }).from(s.referrals).innerJoin(s.referralCodes, eq(s.referralCodes.id, s.referrals.codeId)).where(and(eq(s.referrals.id, referralId), eq(s.referrals.status, "pending_approval")));
  if (!r) throw new DomainError("This referral is not awaiting a decision.");
  await db.update(s.referrals).set({ status: approve ? "rewarded" : "rejected", decidedBy: u.id, decidedAt: new Date() }).where(eq(s.referrals.id, r.r.id));
  if (approve) await award(r.codeFamily, referral.rewardType === "points" ? "points" : "credit_minor", referral.rewardValue, "referral_reward", r.r.id, "Referral reward (approved)", u.id);
  await audit(u.id, approve ? "referral.approve" : "referral.reject", "referral", r.r.id, { reward: approve ? referral.rewardValue : 0 });
}
/** Manual ledger entry (adjustment or redemption) — audited, with a mandatory note. */
export async function adjustLedger(u: CurrentUser, familyId: string, kind: "points" | "credit_minor", delta: number, reason: "adjustment" | "redemption", note: string) {
  if (!can(u, "payments.manage")) throw new DomainError("You don't have permission to change balances.");
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10_000_000) throw new DomainError("Enter a whole, non-zero amount.");
  if (note.trim().length < 5) throw new DomainError("Add a note explaining the change.");
  if (delta < 0) { const b = await balances(familyId); if ((kind === "points" ? b.points : b.creditMinor) + delta < 0) throw new DomainError("That would make the balance negative."); }
  const ref = `${reason}:${Date.now()}:${randomInt(1e9)}`;
  await award(familyId, kind, delta, reason, ref, note.trim().slice(0, 300), u.id);
  await audit(u.id, `ledger.${reason}`, "family", familyId, { kind, delta });
}
