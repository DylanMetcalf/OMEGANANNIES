"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "./shell";
import { signOutAction } from "@/app/(auth)/actions";

function active(path: string, href: string, root: boolean) {
  return root ? path === href : path === href || path.startsWith(href + "/");
}
export function NavLinks({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Portal" className="flex flex-col gap-0.5 px-3">
      {nav.map((n, i) => {
        const on = active(path, n.href, i === 0);
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={on ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-[14px] transition-colors ${on ? "bg-navy text-white" : "text-ink hover:bg-cream"}`}>
            {n.label}
            {!!n.badge && <span className={`rounded-full px-2 text-[11px] font-semibold ${on ? "bg-gold text-navy" : "bg-gold-50 text-gold-600"}`}>{n.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
export function MobileNav({ nav, portal, user }: { nav: NavItem[]; portal: string; user: { name: string } }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; }, [open]);
  return (
    <>
      <button className="btn-secondary btn-sm" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)}>Menu</button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <button aria-label="Close menu" className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <div id="mobile-nav" className="absolute right-0 top-0 flex h-full w-[84%] max-w-[320px] flex-col bg-white pb-6 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4"><div><p className="eyebrow">{portal}</p><p className="text-[14px] text-navy">{user.name}</p></div><button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button></div>
            <NavLinks nav={nav} onNavigate={() => setOpen(false)} />
            <form action={signOutAction} className="mt-auto px-5"><button className="btn-secondary w-full">Sign out</button></form>
          </div>
        </div>
      )}
    </>
  );
}
