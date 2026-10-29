import Link from "next/link";
import { ActionForm, Submit } from "@/components/action-form";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="text-[36px]">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" /></div>
        <Submit className="btn-primary w-full">Update password</Submit>
      </ActionForm>
      <p className="mt-6 text-[14px]"><Link className="link" href="/login">Back to sign in</Link></p>
    </>
  );
}
