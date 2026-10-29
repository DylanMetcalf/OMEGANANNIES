import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { randomToken, sha256 } from "./crypto";
import { can, isManagement, type Permission, type Principal, type Role } from "./permissions";

const COOKIE = "omega_session";
const MGMT_TTL_H = 12, USER_TTL_H = 24 * 7;

export type CurrentUser = Principal & { email: string; name: string; mfaEnabled: boolean; mfaPassed: boolean; isDemo: boolean; sessionId: string };

export async function createSession(userId: string, roles: Role[], mfaPassed = false) {
  const token = randomToken();
  const ttl = roles.some((r) => r !== "family" && r !== "nanny") ? MGMT_TTL_H : USER_TTL_H;
  const expiresAt = new Date(Date.now() + ttl * 3600_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await db.insert(s.sessions).values({ userId, tokenHash: sha256(token), expiresAt, mfaPassed, userAgent: ua });
  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, userId));
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await db.delete(s.sessions).where(eq(s.sessions.tokenHash, sha256(t)));
  jar.delete(COOKIE);
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const [row] = await db.select({ session: s.sessions, user: s.users }).from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.tokenHash, sha256(t)), gt(s.sessions.expiresAt, new Date()))).limit(1);
  if (!row || row.user.status !== "active") return null;
  const roles = (await db.select({ role: s.userRoles.role }).from(s.userRoles).where(eq(s.userRoles.userId, row.user.id))).map((r) => r.role as Role);
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60_000)
    await db.update(s.sessions).set({ lastSeenAt: new Date() }).where(eq(s.sessions.id, row.session.id));
  return {
    id: row.user.id, email: row.user.email, name: row.user.name, roles, permissions: row.user.permissions, status: row.user.status,
    mfaEnabled: row.user.mfaEnabled, mfaPassed: row.session.mfaPassed, isDemo: row.user.isDemo, sessionId: row.session.id,
  };
});

/** Server-side gate for pages and actions. Never rely on hidden UI for access control. */
export async function requireUser(opts: { role?: Role | "management"; perm?: Permission } = {}): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (isManagement(u) && u.mfaEnabled && !u.mfaPassed) redirect("/mfa");
  if (opts.role === "management" ? !isManagement(u) : opts.role && !u.roles.includes(opts.role)) redirect("/forbidden");
  if (opts.perm && !can(u, opts.perm)) redirect("/forbidden");
  return u;
}

/** For server actions / route handlers: throw instead of redirect. */
export class AuthError extends Error { status = 403; }
export async function assertUser(opts: { role?: Role | "management"; perm?: Permission } = {}): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("Not signed in");
  if (isManagement(u) && u.mfaEnabled && !u.mfaPassed) throw new AuthError("MFA required");
  if (opts.role === "management" ? !isManagement(u) : opts.role && !u.roles.includes(opts.role)) throw new AuthError("Not permitted");
  if (opts.perm && !can(u, opts.perm)) throw new AuthError("Not permitted");
  return u;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}
