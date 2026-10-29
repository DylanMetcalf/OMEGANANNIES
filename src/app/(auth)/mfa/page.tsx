import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { getCurrentUser } from "@/lib/auth";
import { mfaAction } from "../actions";

export const metadata = { title: "Two-step verification" };
export default async function Mfa() {
  if (!(await getCurrentUser())) redirect("/login");
  return (
    <>
      <h1 className="text-[28px]">Two-step verification</h1>
      <p className="mt-2 text-muted">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={mfaAction} className="mt-8 space-y-4">
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="input text-center text-[22px] tracking-[0.5em]" aria-label="Verification code" />
        <Submit className="btn-primary w-full">Verify</Submit>
      </ActionForm>
    </>
  );
}
