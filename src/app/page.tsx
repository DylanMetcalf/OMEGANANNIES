import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

export default async function Home() {
  const u = await getCurrentUser();
  if (u) redirect(homeFor(u));
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Image src="/omega-logo.png" alt="Omega Nannies" width={160} height={54} priority />
        <nav className="flex gap-2"><Link href="/help" className="btn-ghost">Help</Link><Link href="/login" className="btn-primary">Sign in</Link></nav>
      </header>
      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.2fr_1fr] lg:pt-20">
        <div>
          <p className="eyebrow">The Omega Nannies portal</p>
          <h1 className="mt-4 text-[48px] leading-[1.05] sm:text-[64px]">Trusted childcare, beautifully arranged.</h1>
          <p className="mt-6 max-w-xl text-[17px] text-muted">One secure place to request a nanny, meet them before you book, approve your quotation, pay safely and stay in touch — with the founders a message away.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/register" className="btn-gold">Create a family account</Link><Link href="/login" className="btn-secondary">Sign in</Link><a href="https://omeganannies.com" className="btn-ghost">Visit omeganannies.com →</a></div>
        </div>
        <div className="grid gap-4">
          {[["For families", "Bookings, quotations, invoices, your children’s care notes and messages."], ["For nannies", "Your schedule, availability, booking instructions and documents."], ["For the Omega team", "Matching, vetting, pricing, payments and reporting in one workspace."]].map(([t, d]) => (
            <div key={t} className="card p-6"><p className="font-display text-[24px] text-navy">{t}</p><p className="mt-1 text-muted">{d}</p></div>
          ))}
        </div>
      </section>
    </main>
  );
}
