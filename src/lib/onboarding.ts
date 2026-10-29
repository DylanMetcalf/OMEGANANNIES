import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "./audit";
import { DomainError } from "./bookings";
import { hashPassword, randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { notify, sendEmailDirect } from "./notify";
import { can, type Permission } from "./permissions";
import { rateLimit } from "./rate-limit";
import type { CurrentUser } from "./auth";

type Nanny = typeof s.nannies.$inferSelect;
type Invitation = typeof s.nannyInvitations.$inferSelect;
export const REQUIRED_DOCS = ["id_document", "police_clearance", "first_aid"] as const;
export const SAFEGUARDING = ["interview", "reference", "identity", "police_clearance", "first_aid"] as const;
export const INVITE_TTL_DAYS = 7;
const MAX_CLAIM_ATTEMPTS = 5;

export type Stage = { key: string; label: string; tone: "neutral" | "info" | "warn" | "ok" | "bad" | "gold"; next: string };

/**
 * Derives a nanny's onboarding stage from real records (account, invitations, documents, checks, status).
 * Nothing is "verified" because a document exists, and claiming an account never approves a nanny.
 */
export function lifecycle(n: Nanny, ctx: { invitation?: Invitation | null; docs: { docType: string; status: string }[]; checks: { kind: string; status: string; expiresOn: string | null }[] }, today = new Date().toISOString().slice(0, 10)): Stage {
  if (n.status === "archived") return { key: "archived", label: "Archived", tone: "neutral", next: "Restore to onboarding if needed." };
  if (n.status === "suspended") return { key: "suspended", label: "Suspended", tone: "bad", next: "Review and reinstate or archive." };
  if (n.status === "approved") return n.published ? { key: "published", label: "Published", tone: "ok", next: "Visible to families and bookable." } : { key: "approved", label: "Approved — not published", tone: "info", next: "Publish when the profile is ready for families." };
  if (n.status === "pending_approval") return { key: "pending_approval", label: "Pending management approval", tone: "gold", next: "Review documents, record checks and approve." };
  if (!n.userId) {
    const inv = ctx.invitation;
    if (inv?.status === "sent" && inv.expiresAt > new Date()) return { key: "invitation_sent", label: "Invitation sent", tone: "info", next: `Waiting for the nanny to claim the account (expires ${inv.expiresAt.toISOString().slice(0, 10)}).` };
    if (inv?.status === "sent") return { key: "invitation_expired", label: "Invitation expired", tone: "warn", next: "Send a new invitation." };
    if (!n.contactEmail) return { key: "draft", label: "Draft — no contact email", tone: "neutral", next: "Add the nanny’s email address, then invite them." };
    return { key: "awaiting_invitation", label: "Awaiting invitation", tone: "neutral", next: "Send the account invitation." };
  }
  const uploaded = new Set(ctx.docs.filter((d) => d.status !== "rejected").map((d) => d.docType));
  const missingDocs = REQUIRED_DOCS.filter((d) => !uploaded.has(d));
  if (missingDocs.length) return { key: "awaiting_documents", label: "Account claimed — awaiting documents", tone: "warn", next: `Waiting for: ${missingDocs.join(", ").replace(/_/g, " ")}.` };
  const current = (k: string) => ctx.checks.some((c) => c.kind === k && c.status === "passed" && (!c.expiresOn || c.expiresOn >= today));
  const missingChecks = SAFEGUARDING.filter((k) => !current(k));
  if (missingChecks.length) return { key: "awaiting_verification", label: "Awaiting verification", tone: "warn", next: `Record checks: ${missingChecks.join(", ").replace(/_/g, " ")}.` };
  return { key: "onboarding_incomplete", label: "Onboarding — ready for nanny submission", tone: "info", next: "The nanny reviews their profile and submits it for approval." };
}

export async function onboardingContext(nannyIds: string[]) {
  if (!nannyIds.length) return { invitations: [] as Invitation[], docs: [] as { ownerNannyId: string | null; docType: string; status: string }[], checks: [] as (typeof s.verificationChecks.$inferSelect)[] };
  const [invitations, docs, checks] = await Promise.all([
    db.select().from(s.nannyInvitations).where(inArray(s.nannyInvitations.nannyId, nannyIds)).orderBy(desc(s.nannyInvitations.createdAt)),
    db.select({ ownerNannyId: s.documents.ownerNannyId, docType: s.documents.docType, status: s.documents.status }).from(s.documents).where(inArray(s.documents.ownerNannyId, nannyIds)),
    db.select().from(s.verificationChecks).where(inArray(s.verificationChecks.nannyId, nannyIds)).orderBy(desc(s.verificationChecks.createdAt)),
  ]);
  return { invitations, docs, checks };
}
export async function stageFor(n: Nanny) {
  const ctx = await onboardingContext([n.id]);
  return lifecycle(n, { invitation: ctx.invitations[0], docs: ctx.docs, checks: ctx.checks });
}

function need(u: CurrentUser, p: Permission) { if (!can(u, p)) throw new DomainError("You don't have permission to do that."); }
const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);
const provEntry = (source: string, by: string | null, verified = false) => ({ source, verified, at: new Date().toISOString(), by });

// ---------------- Management: create & edit pre-created profiles ----------------
export async function createNannyProfile(u: CurrentUser, i: { displayName: string; contactEmail?: string | null; contactPhone?: string | null; headline?: string | null }) {
  need(u, "nannies.manage");
  const name = z.string().trim().min(2, "Enter the nanny’s display name.").max(80).parse(i.displayName);
  const contactEmail = i.contactEmail ? email.parse(i.contactEmail) : null;
  if (contactEmail) await assertEmailFree(contactEmail, null);
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  const provenance = Object.fromEntries(["displayName", ...(i.headline ? ["headline"] : [])].map((k) => [k, provEntry("admin", u.id)]));
  const [n] = await db.insert(s.nannies).values({ displayName: name, slug, status: "draft", contactEmail, contactPhone: i.contactPhone || null, headline: i.headline || null, provenance, isDemo: env.demo, importSource: null }).returning();
  await audit(u.id, "nanny.create", "nanny", n.id);
  return n;
}

/** A contact email may belong to only one nanny profile and must not already be a login. Server-enforced. */
async function assertEmailFree(e: string, nannyId: string | null) {
  const [other] = await db.select({ id: s.nannies.id }).from(s.nannies).where(and(sql`lower(${s.nannies.contactEmail}) = ${e}`, nannyId ? ne(s.nannies.id, nannyId) : undefined));
  if (other) throw new DomainError("Another nanny profile already uses this email address.");
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${e}`);
  if (user) throw new DomainError("This email already belongs to a portal account. Use a different address or link the account manually with support.");
}

export async function setContact(u: CurrentUser, nannyId: string, contactEmail: string | null, contactPhone: string | null) {
  need(u, "nannies.manage");
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, nannyId));
  if (!n) throw new DomainError("Nanny not found.");
  if (n.userId) throw new DomainError("This nanny has claimed their account; they manage their own login email.");
  const e = contactEmail ? email.parse(contactEmail) : null;
  if (e) await assertEmailFree(e, n.id);
  await db.update(s.nannies).set({ contactEmail: e, contactPhone: contactPhone?.slice(0, 40) || null, updatedAt: new Date() }).where(eq(s.nannies.id, n.id));
  // Changing the address invalidates any open invitation sent elsewhere.
  if (e !== n.contactEmail) await db.update(s.nannyInvitations).set({ status: "revoked", revokedAt: new Date(), revokedBy: u.id }).where(and(eq(s.nannyInvitations.nannyId, n.id), eq(s.nannyInvitations.status, "sent")));
  await audit(u.id, "nanny.contact_update", "nanny", n.id);
}

/** Marks profile fields as verified by Omega (records who and when). */
export async function verifyFields(u: CurrentUser, nannyId: string, fields: string[]) {
  need(u, "vetting.manage");
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, nannyId));
  if (!n) throw new DomainError("Nanny not found.");
  const p = { ...(n.provenance as Record<string, { source: string }>) };
  for (const f of fields) p[f] = { ...(p[f] ?? { source: "admin" }), verified: true, verifiedAt: new Date().toISOString(), verifiedBy: u.id } as never;
  await db.update(s.nannies).set({ provenance: p, updatedAt: new Date() }).where(eq(s.nannies.id, n.id));
  await audit(u.id, "nanny.fields_verified", "nanny", n.id, { fields });
}

// ---------------- Invitations ----------------
export async function issueInvitation(u: CurrentUser, nannyId: string): Promise<{ link: string; delivery: string }> {
  need(u, "nannies.manage");
  if (!(await rateLimit(`invite:${nannyId}`, 5, 3600))) throw new DomainError("Too many invitations for this nanny in the last hour.");
  const [n] = await db.select().from(s.nannies).where(eq(s.nannies.id, nannyId));
  if (!n) throw new DomainError("Nanny not found.");
  if (n.userId) throw new DomainError("This profile has already been claimed.");
  if (["archived", "suspended"].includes(n.status)) throw new DomainError("Reinstate the profile before inviting.");
  if (!n.contactEmail) throw new DomainError("Add the nanny’s email address first.");
  await assertEmailFree(n.contactEmail, n.id);
  const token = randomToken(32);
  await db.transaction(async (tx) => {
    await tx.update(s.nannyInvitations).set({ status: "revoked", revokedAt: new Date(), revokedBy: u.id }).where(and(eq(s.nannyInvitations.nannyId, n.id), eq(s.nannyInvitations.status, "sent")));
    await tx.insert(s.nannyInvitations).values({ nannyId: n.id, email: n.contactEmail!, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000), sentBy: u.id });
    if (n.status === "invited") await tx.update(s.nannies).set({ status: "draft" }).where(eq(s.nannies.id, n.id));
  });
  const link = `/claim?token=${token}`;
  const delivery = await sendEmailDirect(n.contactEmail, "Your Omega Nannies profile is ready", `Omega Nannies has prepared your nanny profile. Use this personal link to set up your login and review your details. It works once and expires in ${INVITE_TTL_DAYS} days.`, link);
  await audit(u.id, "nanny.invitation_sent", "nanny", n.id, { delivery });
  return { link, delivery };
}

export async function revokeInvitation(u: CurrentUser, invitationId: string) {
  need(u, "nannies.manage");
  const [inv] = await db.update(s.nannyInvitations).set({ status: "revoked", revokedAt: new Date(), revokedBy: u.id }).where(and(eq(s.nannyInvitations.id, invitationId), eq(s.nannyInvitations.status, "sent"))).returning();
  if (!inv) throw new DomainError("Only open invitations can be revoked.");
  await audit(u.id, "nanny.invitation_revoked", "nanny", inv.nannyId);
  return inv;
}

/** Public view of an invitation for the claim page — reveals no personal data beyond the first name. */
export async function invitationPreview(token: string) {
  const [row] = await db.select({ inv: s.nannyInvitations, name: s.nannies.displayName }).from(s.nannyInvitations).innerJoin(s.nannies, eq(s.nannies.id, s.nannyInvitations.nannyId)).where(eq(s.nannyInvitations.tokenHash, sha256(token)));
  if (!row || row.inv.status !== "sent" || row.inv.expiresAt < new Date()) return null;
  return { firstName: row.name.split(" ")[0] };
}

/**
 * Claim a pre-created profile. The token proves receipt of the invitation email; the claimant must also type the
 * invited email address (bound to the invitation). Failures are rate-limited and repeated failures revoke the token.
 * Responses never reveal whether a token, email or account exists.
 */
export async function claimInvitation(i: { token: string; email: string; name: string; password: string; ip: string }) {
  const generic = new DomainError("This invitation link or email address isn’t valid. Check the email we sent you, or ask Omega Nannies for a new invitation.");
  if (!(await rateLimit(`claim:ip:${i.ip}`, 10, 900)) || !(await rateLimit(`claim:tok:${sha256(i.token).slice(0, 16)}`, 8, 900))) throw new DomainError("Too many attempts. Please wait 15 minutes and try again.");
  const v = z.object({ email, name: z.string().trim().min(2, "Enter your full name.").max(120), password: z.string().min(10, "Password must be at least 10 characters.").max(200) }).parse(i);
  const [inv] = await db.select().from(s.nannyInvitations).where(eq(s.nannyInvitations.tokenHash, sha256(i.token)));
  if (!inv || inv.status !== "sent" || inv.expiresAt < new Date()) throw generic;
  if (inv.email.toLowerCase() !== v.email) {
    const n = inv.failedAttempts + 1;
    await db.update(s.nannyInvitations).set({ failedAttempts: n, ...(n >= MAX_CLAIM_ATTEMPTS ? { status: "revoked", revokedAt: new Date() } : {}) }).where(eq(s.nannyInvitations.id, inv.id));
    await audit(null, "nanny.claim_failed", "nanny", inv.nannyId, { attempts: n, ip: i.ip });
    throw generic;
  }
  const hash = await hashPassword(v.password);
  const userId = await db.transaction(async (tx) => {
    // Lock the invitation; a concurrent second claim sees it accepted.
    const locked = await tx.execute(sql`SELECT id FROM nanny_invitations WHERE id = ${inv.id} AND status = 'sent' FOR UPDATE`);
    if (!locked.rows.length) throw generic;
    const [exists] = await tx.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${v.email}`);
    if (exists) throw generic;
    const [u] = await tx.insert(s.users).values({ email: v.email, name: v.name, passwordHash: hash, status: "active", emailVerifiedAt: new Date(), isDemo: env.demo }).returning();
    await tx.insert(s.userRoles).values({ userId: u.id, role: "nanny", grantedBy: inv.sentBy });
    const linked = await tx.update(s.nannies).set({ userId: u.id, status: sql`CASE WHEN ${s.nannies.status} IN ('draft','invited') THEN 'onboarding'::nanny_status ELSE ${s.nannies.status} END`, updatedAt: new Date() })
      .where(and(eq(s.nannies.id, inv.nannyId), isNull(s.nannies.userId))).returning();
    if (!linked.length) throw generic; // profile already claimed by someone else
    await tx.update(s.nannyInvitations).set({ status: "accepted", acceptedAt: new Date(), acceptedUserId: u.id }).where(eq(s.nannyInvitations.id, inv.id));
    await tx.insert(s.consents).values({ userId: u.id, policy: "privacy", version: "2026-10", granted: true });
    await audit(u.id, "nanny.claimed", "nanny", inv.nannyId, { ip: i.ip }, tx);
    return u.id;
  });
  if (inv.sentBy) await notify(inv.sentBy, "support_update", { subject: "Nanny account claimed", status: "the nanny has claimed their profile" }, `claim:${inv.id}`, `/manage/nannies/${inv.nannyId}`);
  return userId;
}

// ---------------- Nanny: submit for review ----------------
export function completeness(n: Nanny, docs: { docType: string; status: string }[]) {
  const have = new Set(docs.filter((d) => d.status !== "rejected").map((d) => d.docType));
  const items: [string, boolean][] = [
    ["Headline", !!n.headline], ["Biography (80+ characters)", (n.bio ?? "").length >= 80], ["Languages", n.languages.length > 0], ["Services", n.services.length > 0],
    ["Age groups", n.ageGroups.length > 0], ["Service areas", n.areas.length > 0], ["Profile photo", !!n.photoKey || !!n.photoUrl],
    ...REQUIRED_DOCS.map((d) => [`Document: ${d.replace(/_/g, " ")}`, have.has(d)] as [string, boolean]),
  ];
  return { items, pct: Math.round((items.filter(([, ok]) => ok).length / items.length) * 100), missing: items.filter(([, ok]) => !ok).map(([k]) => k) };
}

export async function submitForReview(u: CurrentUser, n: Nanny) {
  if (!["onboarding", "draft"].includes(n.status)) throw new DomainError("Your profile is already with Omega for review or has been approved.");
  const docs = await db.select({ docType: s.documents.docType, status: s.documents.status }).from(s.documents).where(eq(s.documents.ownerNannyId, n.id));
  const c = completeness(n, docs);
  if (c.missing.length) throw new DomainError(`Please complete: ${c.missing.join(", ")}.`);
  await db.update(s.nannies).set({ status: "pending_approval", submittedForReviewAt: new Date(), updatedAt: new Date() }).where(eq(s.nannies.id, n.id));
  await audit(u.id, "nanny.submitted_for_review", "nanny", n.id);
  const managers = await db.select({ id: s.users.id }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).where(and(inArray(s.userRoles.role, ["manager", "admin"]), eq(s.users.status, "active")));
  for (const m of managers) await notify(m.id, "support_update", { subject: `${n.displayName} submitted their profile`, status: "ready for review" }, `review:${n.id}:${Date.now() >> 16}`, `/manage/nannies/${n.id}`);
}

export const provenanceEntry = provEntry;
