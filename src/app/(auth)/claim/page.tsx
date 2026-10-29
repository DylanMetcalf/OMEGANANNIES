import { ActionForm, Submit } from "@/components/action-form";
import { Notice, Steps } from "@/components/ui";
import { invitationPreview } from "@/lib/onboarding";
import { claimAction } from "../actions";

export const metadata = { title: "Claim your profile" };
export default async function Claim({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const inv = token.length > 20 ? await invitationPreview(token) : null;
  if (!inv) return (
    <>
      <h1 className="text-[28px]">This invitation can’t be used</h1>
      <div className="mt-6"><Notice tone="warn">It may have expired, been replaced by a newer invitation, or already been used. Please ask Omega Nannies to send you a new one.</Notice></div>
    </>
  );
  return (
    <>
      <Steps steps={["Claim account", "Review profile", "Upload documents", "Submit"]} current={0} />
      <p className="eyebrow mt-8">Welcome, {inv.firstName}</p>
      <h1 className="mt-2 text-[28px]">Your Omega profile is ready</h1>
      <p className="mt-2 text-muted">Omega Nannies has prepared your profile. Confirm the email address this invitation was sent to and choose a password — then you can review your details.</p>
      <ActionForm action={claimAction} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="email">Email address the invitation was sent to</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
        <div><label className="label" htmlFor="name">Your full name</label><input id="name" name="name" autoComplete="name" required className="input" /></div>
        <div><label className="label" htmlFor="password">Choose a password</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" aria-describedby="pw-h" /><p id="pw-h" className="mt-1 text-[12px] text-muted">At least 10 characters. Your link works once.</p></div>
        <label className="flex gap-2.5 text-[13px]"><input type="checkbox" name="privacy" required className="mt-0.5 h-4 w-4 accent-navy" /><span>I accept the Omega Nannies <a className="link" href="https://omeganannies.com/privacy">privacy notice</a> (POPIA).</span></label>
        <Submit className="btn-primary w-full" pendingText="Setting up…">Claim my profile</Submit>
      </ActionForm>
    </>
  );
}
