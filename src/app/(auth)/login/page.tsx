import Link from "next/link";
import { ActionForm, Submit } from "@/components/action-form";
import { Notice } from "@/components/ui";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/site";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; welcome?: string; verified?: string; closed?: string; "email-changed"?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const msg = sp.welcome ? "Your account is ready. Please sign in." : sp.verified ? "Email confirmed — your account is active. Please sign in." : sp["email-changed"] ? "Your email address was changed. Sign in with the new address." : sp.closed ? "Your account has been closed." : null;
  return (
    <>
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-2 text-[28px]">Sign in to your portal</h1>
      <p className="mt-2 text-muted">Families, nannies and the Omega team all sign in here.</p>
      {msg && <div className="mt-6"><Notice tone="ok">{msg}</Notice></div>}
      {next?.startsWith("/family/book") && <div className="mt-6"><Notice tone="info">Sign in to continue booking. New to Omega? <Link className="link" href="/register">Create a family account</Link> — it takes a minute.</Notice></div>}
      <ActionForm action={signInAction} className="mt-8 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="password">Password</label><Link href="/forgot-password" className="text-[13px] link">Forgot password?</Link></div>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <Submit className="btn-primary w-full" pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      <p className="mt-6 text-[14px] text-muted">New family? <Link className="link" href="/register">Create an account</Link>. Nannies join by invitation from Omega.</p>
      {env.demo && (
        <div className="mt-8 rounded-xl border border-line bg-white p-4 text-[13px]">
          <p className="font-medium text-navy">Demo accounts (password: <code>OmegaDemo2026!</code>)</p>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Family — <code>family.demo@example.com</code></li>
            <li>Nanny — <code>nanny.demo@example.com</code></li>
            <li>Manager — <code>manager.demo@example.com</code></li>
            <li>Admin — <code>admin.demo@example.com</code></li>
          </ul>
        </div>
      )}
    </>
  );
}
