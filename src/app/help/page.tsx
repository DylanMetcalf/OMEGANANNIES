import Image from "next/image";
import Link from "next/link";
import { AssistantBox } from "@/components/assistant-box";
import { Empty } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { searchArticles } from "@/lib/assistant";
import { env } from "@/lib/env";
import { homeFor } from "@/lib/permissions";

export const metadata = { title: "Help centre" };
export default async function Help({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await getCurrentUser();
  const q = (await searchParams).q?.slice(0, 200) ?? "";
  const aud = ["public", ...(u?.roles.includes("family") ? ["family"] : []), ...(u?.roles.includes("nanny") ? ["nanny"] : [])];
  const arts = await searchArticles(q, aud, q ? 20 : 100);
  const cats = [...new Set(arts.map((a) => a.category))];
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Link href="/"><Image src="/omega-logo.png" alt="Omega Nannies" width={130} height={44} /></Link><Link href={u ? homeFor(u) : "/login"} className="btn-secondary btn-sm">{u ? "Back to portal" : "Sign in"}</Link></div></header>
      <main id="main" className="mx-auto max-w-5xl px-5 py-10">
        <p className="eyebrow">Help centre</p>
        <h1 className="mt-2 text-[44px]">How can we help?</h1>
        <form className="mt-6 flex max-w-xl gap-2" role="search"><label htmlFor="q" className="sr-only">Search help</label><input id="q" name="q" defaultValue={q} placeholder="Search bookings, payments, vetting…" className="input" /><button className="btn-primary">Search</button></form>
        {env.anthropicKey && <div className="mt-6 max-w-3xl"><AssistantBox /></div>}
        <div className="mt-10 space-y-10">
          {arts.length === 0 && <Empty title="No articles match" action={<Link href="/messages" className="btn-primary">Ask the team</Link>}>Try different words, or message us directly.</Empty>}
          {cats.map((c) => (
            <section key={c}>
              <h2 className="mb-3 text-[26px]">{c}</h2>
              <div className="space-y-2">{arts.filter((a) => a.category === c).map((a) => (
                <details key={a.id} id={a.slug} className="card p-4" open={!!q && arts.length <= 3}>
                  <summary className="cursor-pointer font-medium text-navy">{a.title}</summary>
                  <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{a.body}</p>
                  {a.sourceUrl && <p className="mt-2 text-[12px] text-muted">Source: <a className="link" href={a.sourceUrl}>omeganannies.com</a></p>}
                </details>
              ))}</div>
            </section>
          ))}
        </div>
        <div className="mt-12 rounded-2xl bg-navy p-8 text-white"><p className="font-display text-[28px]">Still need a hand?</p><p className="mt-1 text-white/75">You&rsquo;ll speak to a founder, not a call centre — within 4 hours, 7 days a week.</p><div className="mt-4 flex flex-wrap gap-2"><Link href={u ? "/messages" : "/login"} className="btn-gold">Message us</Link><a href="mailto:enquiries@omeganannies.com" className="btn border border-white/30 text-white">enquiries@omeganannies.com</a></div></div>
      </main>
    </div>
  );
}
