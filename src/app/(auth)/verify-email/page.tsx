import { ActionForm, Submit } from "@/components/action-form";
import { verifyEmailAction } from "../actions";

export const metadata = { title: "Confirm email" };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="text-[28px]">Confirm your email address</h1>
      <p className="mt-2 text-muted">One last step to activate your Omega Nannies account.</p>
      <ActionForm action={verifyEmailAction} className="mt-6"><input type="hidden" name="token" value={token} /><Submit className="btn-primary w-full" pendingText="Confirming…">Confirm and continue</Submit></ActionForm>
    </>
  );
}
