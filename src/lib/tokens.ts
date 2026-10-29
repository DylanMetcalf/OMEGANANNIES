import "server-only";
import { db, schema as s } from "@/db";
import { randomToken, sha256 } from "./crypto";
import type { Role } from "./permissions";

/** Single-use, hashed-at-rest tokens for email verification, password reset and invitations. Not a server action. */
export async function issueToken(kind: "verify_email" | "reset_password" | "invite" | "change_email", hours: number, v: { userId?: string; email?: string; role?: Role; subjectId?: string; createdBy?: string }) {
  const token = randomToken();
  await db.insert(s.authTokens).values({ kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000), ...v });
  return token;
}
