import Link from "next/link";
import { Notice } from "@/components/ui";
import { verifyEmailAction } from "../actions";

export const metadata = { title: "Confirm email" };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const err = token ? await verifyEmailAction(token) : "Missing confirmation token.";
  return (
    <>
      <h1 className="text-[36px]">{err ? "We couldn't confirm that link" : "Email confirmed"}</h1>
      <div className="mt-6">{err ? <Notice tone="bad">{err}</Notice> : <Notice tone="ok">Thank you — your account is active.</Notice>}</div>
      <Link href="/login" className="btn-primary mt-6 w-full">Continue to sign in</Link>
    </>
  );
}
