import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center"><p className="eyebrow">Not found</p><h1 className="mt-2 text-[36px]">We couldn&rsquo;t find that page</h1><p className="mt-3 text-muted">It may have moved, or you may not have access to it.</p><Link href="/" className="btn-primary mt-6">Go to my portal</Link></main>;
}
