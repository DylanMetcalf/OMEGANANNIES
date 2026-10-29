import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, LayoutDashboard, ShieldCheck, UserRound } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

const PORTALS = [
  { icon: CalendarCheck, title: "For families", body: "Request care, meet your nanny, approve your quote, pay securely and keep your children’s routines in one private place." },
  { icon: UserRound, title: "For nannies", body: "Your schedule, booking instructions, availability, documents and vetting status — on your phone." },
  { icon: LayoutDashboard, title: "For the Omega team", body: "Enquiries, matching, onboarding, pricing, payments and reporting in one workspace." },
];
export default async function Home() {
  const u = await getCurrentUser();
  if (u) redirect(homeFor(u));
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Image src="/omega-logo.png" alt="Omega Nannies" width={140} height={47} priority />
        <nav className="flex gap-2"><Link href="/help" className="btn-ghost">Help</Link><Link href="/login" className="btn-primary">Sign in</Link></nav>
      </header>
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="animate-in">
            <p className="eyebrow">The Omega Nannies portal</p>
            <h1 className="mt-4 text-[40px] leading-[1.08] sm:text-[54px]">Trusted childcare, beautifully arranged.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">One secure place to request a nanny, meet them before you book, approve your quotation, pay safely and stay in touch — with the founders a message away.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/register" className="btn-gold">Create a family account</Link><Link href="/login" className="btn-secondary">Sign in</Link></div>
            <p className="mt-6 flex items-center gap-2 text-[13px] text-muted"><ShieldCheck aria-hidden className="h-4 w-4 text-ok" />Every Omega nanny is interviewed, police-clearance verified, First Aid certified and reference checked.</p>
          </div>
          <div className="relative mx-auto w-full max-w-[440px]">
            <Image src="/brand/hero.webp" alt="An Omega nanny playing with two children in Cape Town" width={864} height={1296} priority className="aspect-[4/5] w-full rounded-[20px] object-cover shadow-[var(--shadow-pop)]" />
          </div>
        </section>
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 md:grid-cols-3">
            {PORTALS.map(({ icon: I, title, body }) => (
              <div key={title}><span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-navy-50 text-navy"><I aria-hidden className="h-5 w-5" /></span><h2 className="mt-4 text-[18px]">{title}</h2><p className="mt-1.5 text-[15px] text-muted">{body}</p></div>
            ))}
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2">
          <Image src="/brand/founders.webp" alt="Danica Tromp and Megan Roux, co-founders of Omega Nannies" width={1200} height={960} className="w-full rounded-[16px] object-cover" />
          <div><p className="eyebrow">Founder-led</p><h2 className="mt-3 text-[28px]">You speak to a founder, not a call centre.</h2><p className="mt-3 text-muted">Omega Nannies is a referral and invitation-only network. Every nanny is interviewed personally by one of the founders.</p><a href="https://omeganannies.com/about" className="link mt-5 inline-block">About Omega Nannies</a></div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-[13px] text-muted">© Omega Nannies · <a className="link" href="https://omeganannies.com/privacy">Privacy</a> · <a className="link" href="https://omeganannies.com/terms">Terms</a> · enquiries@omeganannies.com</footer>
    </div>
  );
}
