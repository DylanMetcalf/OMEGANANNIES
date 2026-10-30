"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark } from "lucide-react";

/** Persistent shortlist summary on the discovery step; updates instantly when a nanny is (de)selected. */
export function ShortlistBar({ initial }: { initial: number }) {
  const [n, setN] = useState(initial);
  useEffect(() => { const h = (e: Event) => setN((e as CustomEvent<number>).detail); window.addEventListener("omega:shortlist", h); return () => window.removeEventListener("omega:shortlist", h); }, []);
  return (
    <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 mt-8 lg:bottom-4">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-[16px] border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
        <p className="flex items-center gap-2 text-[14px] font-medium" aria-live="polite"><Bookmark aria-hidden className="h-[18px] w-[18px] text-navy" /><span><strong className="tabular-nums">{n}</strong> shortlisted</span></p>
        <div className="flex items-center gap-2">
          {n >= 2 && <Link href="/family/shortlist" className="btn-ghost btn-sm hidden sm:inline-flex">Compare</Link>}
          <Link href={n ? "/family/book/review" : "/family/book/review?help=1"} className="btn-primary btn-sm">{n ? "Continue" : "Ask Omega to choose"}<ArrowRight aria-hidden className="h-4 w-4" /></Link>
        </div>
      </div>
    </div>
  );
}
