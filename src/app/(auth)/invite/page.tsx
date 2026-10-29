import { and, eq, gt, isNull } from "drizzle-orm";
import { ActionForm, Submit } from "@/components/action-form";
import { Notice } from "@/components/ui";
import { db, schema as s } from "@/db";
import { sha256 } from "@/lib/crypto";
import { acceptInviteAction } from "../actions";

export const metadata = { title: "Accept invitation" };
export default async function Invite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const [t] = token ? await db.select().from(s.authTokens).where(and(eq(s.authTokens.tokenHash, sha256(token)), eq(s.authTokens.kind, "invite"), isNull(s.authTokens.usedAt), gt(s.authTokens.expiresAt, new Date()))) : [];
  if (!t) return <><h1 className="text-[36px]">Invitation unavailable</h1><div className="mt-6"><Notice tone="bad">This invitation is invalid, already used or expired. Please ask Omega Nannies for a new one.</Notice></div></>;
  return (
    <>
      <p className="eyebrow">You&rsquo;re invited</p>
      <h1 className="mt-2 text-[36px]">Join Omega Nannies</h1>
      <p className="mt-2 text-muted">Setting up <strong>{t.email}</strong> as {t.role === "nanny" ? "an Omega nanny" : `team member (${t.role})`}.</p>
      <ActionForm action={acceptInviteAction} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="name">Full name</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" /></div>
        <label className="flex gap-2.5 text-[13px]"><input type="checkbox" name="privacy" required className="mt-0.5 h-4 w-4 accent-navy" /><span>I accept the Omega Nannies privacy notice (POPIA).</span></label>
        <Submit className="btn-primary w-full">Create my account</Submit>
      </ActionForm>
    </>
  );
}
