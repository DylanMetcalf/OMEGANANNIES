import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { Notice } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { isManagement } from "@/lib/permissions";
import { confirmMfaAction, startMfaAction } from "@/app/manage/actions";

export const metadata = { title: "Set up two-step verification" };
/** Mandatory enrolment for staff (REQUIRE_STAFF_MFA): the management portal stays locked until this is done. */
export default async function MfaSetup() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!isManagement(u)) redirect("/");
  return (
    <>
      <p className="eyebrow">Security</p>
      <h1 className="mt-2 text-[28px]">Set up two-step verification</h1>
      <p className="mt-2 text-muted">Staff accounts can see children’s and families’ private information, so a code from an authenticator app is required at every sign-in.</p>
      {u.mfaEnabled ? <div className="mt-6"><Notice tone="ok">Two-step verification is on. <Link className="link" href="/manage">Continue to the portal</Link></Notice></div> : (
        <div className="mt-6 space-y-5">
          <ActionForm action={startMfaAction}><Submit className="btn-secondary w-full">1. Generate my setup key</Submit></ActionForm>
          <ActionForm action={confirmMfaAction} className="space-y-3">
            <label className="label" htmlFor="code">2. Enter the 6-digit code from your app</label>
            <input id="code" name="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" required className="input text-center text-[20px] tracking-[0.4em]" />
            <Submit className="btn-primary w-full">Turn on two-step verification</Submit>
          </ActionForm>
        </div>
      )}
    </>
  );
}
