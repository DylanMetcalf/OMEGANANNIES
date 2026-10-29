"use server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { clientIp, createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { hashPassword, sha256, verifyPassword, verifyTotp } from "@/lib/crypto";
import { issueToken } from "@/lib/tokens";
import { env } from "@/lib/env";
import { bool, email, password, run, str } from "@/lib/forms";
import { deliverPending, notify } from "@/lib/notify";
import { homeFor, isManagement, type Role } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { DomainError } from "@/lib/bookings";
import type { ActionResult } from "@/components/action-form";

async function consumeToken(kind: "verify_email" | "reset_password" | "invite", token: string) {
  const [t] = await db.update(s.authTokens).set({ usedAt: new Date() })
    .where(and(eq(s.authTokens.kind, kind), eq(s.authTokens.tokenHash, sha256(token)), isNull(s.authTokens.usedAt), gt(s.authTokens.expiresAt, new Date()))).returning();
  if (!t) throw new DomainError("This link is invalid or has expired. Please request a new one.");
  return t;
}
const demoLink = (path: string): ActionResult => (env.demo ? { ok: `Demo mode — email captured, not sent. Continue here: ${path}` } : null);

export async function signInAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let dest = "/";
  const r = await run(async () => {
    const e = email.parse(str(fd, "email"));
    const ip = await clientIp();
    if (!(await rateLimit(`login:${ip}`, 20, 900)) || !(await rateLimit(`login:${e}`, 8, 900))) throw new DomainError("Too many attempts. Please wait 15 minutes and try again.");
    const [u] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${e}`);
    const ok = await verifyPassword(str(fd, "password"), u?.passwordHash ?? null);
    if (!u || !ok) { await audit(u?.id ?? null, "auth.login_failed", "user", u?.id ?? null, { ip }); throw new DomainError("Email or password is incorrect."); }
    if (u.status === "suspended" || u.status === "closed") throw new DomainError("This account is not active. Please contact Omega Nannies.");
    if (!u.emailVerifiedAt) throw new DomainError("Please confirm your email address first — check your inbox for the link.");
    const roles = (await db.select().from(s.userRoles).where(eq(s.userRoles.userId, u.id))).map((x) => x.role as Role);
    await createSession(u.id, roles, false);
    await audit(u.id, "auth.login", "user", u.id, { ip });
    const p = { id: u.id, roles, permissions: u.permissions, status: u.status };
    dest = isManagement(p) && u.mfaEnabled ? "/mfa" : homeFor(p);
    return { ok: "Signed in" };
  });
  if (r?.ok) redirect(dest);
  return r;
}

export async function signOutAction() {
  const u = await getCurrentUser();
  await destroySession();
  if (u) await audit(u.id, "auth.logout", "user", u.id);
  redirect("/login");
}

export async function registerFamilyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const v = z.object({ name: z.string().min(2, "Enter your name.").max(120), email, password, household: z.string().min(2, "Enter a household name.").max(120), audience: z.enum(["visiting", "resident"]), country: z.string().max(80) })
      .parse({ name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password"), household: str(fd, "household"), audience: str(fd, "audience"), country: str(fd, "country") });
    if (!bool(fd, "privacy")) throw new DomainError("Please accept the privacy notice to create an account.");
    if (!(await rateLimit(`register:${await clientIp()}`, 5, 3600))) throw new DomainError("Too many registrations from this network. Try again later.");
    const [existing] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${v.email}`);
    let link = "";
    if (!existing) {
      const hash = await hashPassword(v.password);
      const userId = await db.transaction(async (tx) => {
        const [u] = await tx.insert(s.users).values({ email: v.email, name: v.name, passwordHash: hash, status: "pending", isDemo: env.demo }).returning();
        await tx.insert(s.userRoles).values({ userId: u.id, role: "family" });
        const [f] = await tx.insert(s.families).values({ displayName: v.household, audience: v.audience, countryOfResidence: v.country || null, billingName: v.name, billingEmail: v.email, isDemo: env.demo }).returning();
        await tx.insert(s.familyMembers).values({ familyId: f.id, userId: u.id, relationship: "Parent", isPrimary: true });
        await tx.insert(s.consents).values([{ userId: u.id, policy: "privacy", version: "2026-10", granted: true }, { userId: u.id, policy: "marketing", version: "2026-10", granted: bool(fd, "marketing") }]);
        await tx.insert(s.notificationPreferences).values({ userId: u.id, marketingOptIn: bool(fd, "marketing") });
        return u.id;
      });
      const token = await issueToken("verify_email", 24, { userId });
      link = `/verify-email?token=${token}`;
      await notify(userId, "verify_email", {}, `verify:${token.slice(0, 12)}`, link);
      await audit(userId, "auth.register", "user", userId);
      void deliverPending();
    }
    // Same response whether or not the email exists (no account enumeration).
    return demoLink(link || "/login") ?? { ok: "Thank you. Check your inbox for a link to confirm your email address." };
  });
}

export async function verifyEmailAction(token: string): Promise<string | null> {
  try {
    const t = await consumeToken("verify_email", token);
    await db.update(s.users).set({ emailVerifiedAt: new Date(), status: "active" }).where(and(eq(s.users.id, t.userId!), eq(s.users.status, "pending")));
    await db.update(s.users).set({ emailVerifiedAt: new Date() }).where(eq(s.users.id, t.userId!));
    await audit(t.userId!, "auth.email_verified", "user", t.userId!);
    return null;
  } catch (e) { return (e as Error).message; }
}

export async function forgotPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const e = email.parse(str(fd, "email"));
    if (!(await rateLimit(`forgot:${e}`, 3, 3600))) return { ok: "If an account exists for that address, we've sent a reset link." };
    const [u] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${e}`);
    let link = "";
    if (u && u.status !== "closed") {
      const token = await issueToken("reset_password", 1, { userId: u.id });
      link = `/reset-password?token=${token}`;
      await notify(u.id, "reset_password", {}, `reset:${token.slice(0, 12)}`, link);
      void deliverPending();
    }
    return (link && demoLink(link)) || { ok: "If an account exists for that address, we've sent a reset link." };
  });
}

export async function resetPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const pw = password.parse(str(fd, "password"));
    const t = await consumeToken("reset_password", str(fd, "token"));
    await db.update(s.users).set({ passwordHash: await hashPassword(pw), updatedAt: new Date() }).where(eq(s.users.id, t.userId!));
    await db.delete(s.sessions).where(eq(s.sessions.userId, t.userId!)); // sign out everywhere
    await audit(t.userId!, "auth.password_reset", "user", t.userId!);
    return { ok: "Password updated. You can now sign in." };
  });
}

export async function acceptInviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    const v = z.object({ name: z.string().min(2).max(120), password }).parse({ name: str(fd, "name"), password: str(fd, "password") });
    if (!bool(fd, "privacy")) throw new DomainError("Please accept the privacy notice.");
    const t = await consumeToken("invite", str(fd, "token"));
    const [exists] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${t.email!.toLowerCase()}`);
    if (exists) throw new DomainError("An account already exists for this email. Please sign in.");
    const hash = await hashPassword(v.password);
    await db.transaction(async (tx) => {
      const [u] = await tx.insert(s.users).values({ email: t.email!, name: v.name, passwordHash: hash, status: "active", emailVerifiedAt: new Date(), isDemo: env.demo }).returning();
      await tx.insert(s.userRoles).values({ userId: u.id, role: t.role!, grantedBy: t.createdBy });
      if (t.role === "family" && t.subjectId) await tx.insert(s.familyMembers).values({ familyId: t.subjectId, userId: u.id, relationship: "Household member", isPrimary: false });
      if (t.role === "nanny" && t.subjectId) await tx.update(s.nannies).set({ userId: u.id, status: sql`CASE WHEN ${s.nannies.status} = 'invited' THEN 'onboarding'::nanny_status ELSE ${s.nannies.status} END` }).where(eq(s.nannies.id, t.subjectId));
      await tx.insert(s.consents).values({ userId: u.id, policy: "privacy", version: "2026-10", granted: true });
      await audit(u.id, "auth.invite_accepted", "user", u.id, { role: t.role }, tx);
    });
    return { ok: "Account created" };
  });
  if (r?.ok) redirect("/login?welcome=1");
  return r;
}

export async function mfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    const u = await getCurrentUser();
    if (!u) throw new DomainError("Session expired. Please sign in again.");
    if (!(await rateLimit(`mfa:${u.id}`, 6, 300))) throw new DomainError("Too many attempts. Wait 5 minutes.");
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    if (!row.mfaSecret || !verifyTotp(row.mfaSecret, str(fd, "code"))) { await audit(u.id, "auth.mfa_failed", "user", u.id); throw new DomainError("That code didn't match. Try the latest code from your app."); }
    await db.update(s.sessions).set({ mfaPassed: true }).where(eq(s.sessions.id, u.sessionId));
    return { ok: "Verified" };
  });
  if (r?.ok) redirect("/manage");
  return r;
}

