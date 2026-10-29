import { ActionForm, Submit } from "@/components/action-form";
import { confirmEmailChangeAction } from "@/app/account/actions";

export const metadata = { title: "Confirm email" };
/** Confirmation requires a click (POST), so link scanners that prefetch emails can't consume the token. */
export default async function ConfirmEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="text-[28px]">Confirm your new email</h1>
      <p className="mt-2 text-muted">Confirming makes this your sign-in address. You’ll be signed out of all devices and can sign in again with it.</p>
      <ActionForm action={confirmEmailChangeAction} className="mt-6"><input type="hidden" name="token" value={token} /><Submit className="btn-primary w-full">Confirm email address</Submit></ActionForm>
    </>
  );
}
