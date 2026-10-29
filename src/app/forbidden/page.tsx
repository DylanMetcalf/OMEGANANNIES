import Link from "next/link";
export const metadata = { title: "Not available" };
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">Access</p>
      <h1 className="mt-2 text-[36px]">This page isn&rsquo;t available to your account</h1>
      <p className="mt-3 text-muted">If you think you should have access, please contact the Omega Nannies team.</p>
      <Link href="/" className="btn-primary mt-6">Go to my portal</Link>
    </main>
  );
}
