import Link from "next/link";
import { ActionForm, Submit } from "@/components/action-form";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password" };
export default function Forgot() {
  return (
    <>
      <h1 className="text-[28px]">Reset your password</h1>
      <p className="mt-2 text-muted">Enter your email and we&rsquo;ll send a secure link, valid for one hour.</p>
      <ActionForm action={forgotPasswordAction} className="mt-8 space-y-4">
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" /></div>
        <Submit className="btn-primary w-full" pendingText="Sending…">Send reset link</Submit>
      </ActionForm>
      <p className="mt-6 text-[14px]"><Link className="link" href="/login">Back to sign in</Link></p>
    </>
  );
}
