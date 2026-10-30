"use client";
import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * A short, branded greeting shown once right after signing in (flagged by a one-minute cookie the sign-in sets).
 * About a second, dismissible, never repeated on later page loads, and static under reduced motion.
 */
export function Welcome({ name, line }: { name: string; line: string }) {
  const [show, setShow] = useState<"" | "new" | "back">("");
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )omega_welcome=(new|back)/);
    if (!m) return;
    document.cookie = "omega_welcome=; Max-Age=0; path=/; SameSite=Lax";
    setShow(m[1] as "new" | "back");
    const t = setTimeout(() => setShow(""), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1600 : 1300);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" onClick={() => setShow("")} className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-cream/95 backdrop-blur-sm animate-in">
      <div className="text-center animate-rise">
        <Image src="/omega-logo.png" alt="" width={150} height={50} className="mx-auto" priority />
        <p className="mt-6 font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{show === "new" ? `Welcome to Omega, ${name}` : `Welcome back, ${name}`}</p>
        <p className="mt-2 text-[15px] text-muted">{line}</p>
        <span aria-hidden className="mx-auto mt-6 block h-0.5 w-16 overflow-hidden rounded-full bg-sand"><span className="block h-full w-full origin-left animate-[grow_1.1s_ease-out_forwards] bg-gold motion-reduce:animate-none" /></span>
      </div>
    </div>
  );
}
