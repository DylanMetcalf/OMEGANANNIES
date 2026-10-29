import Image from "next/image";
import Link from "next/link";
import { env } from "@/lib/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border border-gold/20" aria-hidden />
        <div className="absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full border border-gold/10" aria-hidden />
        <Link href="/" className="relative inline-block w-fit rounded-lg bg-cream px-4 py-3"><Image src="/omega-logo.png" alt="Omega Nannies" width={170} height={57} priority /></Link>
        <div className="relative mt-auto max-w-md">
          <p className="eyebrow !text-gold">Cape Town · Western Cape</p>
          <p className="mt-4 font-display text-[44px] leading-[1.1] text-white">Childhood is short. Holidays together are few.</p>
          <p className="mt-4 text-white/75">Every Omega nanny is personally interviewed, police-clearance verified, First Aid certified and reference checked.</p>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-[13px] text-white/85">
            {["Replacement guarantee", "Meet before you book", "4-hour response, 7 days", "Founder-led matching"].map((x) => <li key={x} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-gold" />{x}</li>)}
          </ul>
        </div>
      </aside>
      <main id="main" className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden"><Link href="/"><Image src="/omega-logo.png" alt="Omega Nannies" width={140} height={47} priority /></Link></div>
        {env.demo && <p className="mt-4 rounded-lg bg-gold-50 px-3 py-2 text-[12px] text-gold-600">Demonstration environment — synthetic data, no real payments or emails.</p>}
        <div className="mx-auto my-auto w-full max-w-[420px] py-10">{children}</div>
        <p className="text-center text-[12px] text-muted">Protected under POPIA · <a className="link" href="https://omeganannies.com/privacy">Privacy</a> · <a className="link" href="https://omeganannies.com/terms">Terms</a></p>
      </main>
    </div>
  );
}
