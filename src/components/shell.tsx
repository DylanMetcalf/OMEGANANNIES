import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNav, NavLinks } from "./nav";
import { signOutAction } from "@/app/(auth)/actions";
import { env } from "@/lib/env";

export type NavItem = { href: string; label: string; badge?: number };

export function PortalShell({ portal, nav, user, children, unread = 0 }: { portal: string; nav: NavItem[]; user: { name: string; email: string }; children: ReactNode; unread?: number }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden border-r border-line bg-white lg:flex lg:flex-col">
        <div className="px-6 pb-4 pt-6">
          <Link href="/" aria-label="Omega Nannies home"><Image src="/omega-logo.png" alt="Omega Nannies" width={168} height={57} priority /></Link>
          <p className="eyebrow mt-3">{portal}</p>
        </div>
        <NavLinks nav={nav} />
        <UserBlock user={user} unread={unread} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/"><Image src="/omega-logo.png" alt="Omega Nannies" width={120} height={40} priority /></Link>
          <MobileNav nav={nav} portal={portal} user={user} />
        </header>
        {env.demo && <div className="border-b border-gold/30 bg-gold-50 px-4 py-1.5 text-center text-[12px] text-gold-600">Demonstration environment — synthetic data only. No real payments or emails are sent.</div>}
        <main id="main" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}

function UserBlock({ user, unread }: { user: { name: string; email: string }; unread: number }) {
  return (
    <div className="mt-auto border-t border-line p-4">
      <p className="truncate text-[14px] font-medium text-navy">{user.name}</p>
      <p className="truncate text-[12px] text-muted">{user.email}</p>
      {unread > 0 && <p className="mt-1 text-[12px] text-gold-600">{unread} unread notification{unread > 1 ? "s" : ""}</p>}
      <form action={signOutAction} className="mt-3"><button className="btn-secondary btn-sm w-full">Sign out</button></form>
    </div>
  );
}
