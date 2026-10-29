import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Video, Clock, HeartHandshake } from "lucide-react";
import { env } from "@/lib/env";

const POINTS = [
  { icon: ShieldCheck, text: "Every nanny interviewed, police-clearance verified and First Aid certified" },
  { icon: Video, text: "Meet your nanny by video before you book" },
  { icon: Clock, text: "A reply within 4 hours, 7 days a week" },
  { icon: HeartHandshake, text: "Founder-led, with a replacement guarantee" },
];
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main id="main" className="flex flex-col px-5 py-8 sm:px-12">
        <Link href="/" className="w-fit"><Image src="/omega-logo.png" alt="Omega Nannies" width={132} height={44} priority /></Link>
        {env.demo && <p className="mt-5 w-fit rounded-full bg-gold-50 px-3 py-1 text-[12px] font-medium text-gold-600">Demo environment — synthetic data, no real payments or emails</p>}
        <div className="mx-auto my-auto w-full max-w-[400px] animate-in py-10">{children}</div>
        <p className="text-[12px] text-muted">Protected under POPIA · <a className="link" href="https://omeganannies.com/privacy">Privacy</a> · <a className="link" href="https://omeganannies.com/terms">Terms</a></p>
      </main>
      <aside className="relative hidden overflow-hidden bg-navy p-14 text-white lg:flex lg:flex-col lg:justify-end">
        <Image src="/brand/hero.webp" alt="" fill priority sizes="50vw" className="object-cover" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-navy/10" />
        <div className="relative max-w-[480px]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">Cape Town · Western Cape</p>
          <p className="mt-4 font-display text-[40px] font-bold leading-[1.1] tracking-[-0.02em]">Childhood is short. Make every holiday count.</p>
          <ul className="mt-10 space-y-4">
            {POINTS.map(({ icon: I, text }) => <li key={text} className="flex items-start gap-3 text-[15px] text-white/85"><span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10"><I aria-hidden className="h-4 w-4 text-gold" /></span>{text}</li>)}
          </ul>
        </div>
      </aside>
    </div>
  );
}
