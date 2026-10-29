import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, LogOut } from "lucide-react";
import { BottomTabs, MobileNav, NavLinks } from "./nav";
import { Avatar } from "./ui";
import { signOutAction } from "@/app/(auth)/actions";
import { env } from "@/lib/env";

export type NavItem = { href: string; label: string; icon: string; badge?: number };

export function PortalShell({ portal, nav, user, children, unread = 0 }: { portal: string; nav: NavItem[]; user: { name: string; email: string }; children: ReactNode; unread?: number }) {
  const bell = (
    <Link href="/notifications" prefetch={false} className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sand hover:text-ink" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
      <Bell aria-hidden className="h-5 w-5" strokeWidth={1.8} />
      {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-gold ring-2 ring-surface" />}
    </Link>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface lg:flex">
        <div className="px-6 pb-5 pt-6">
          <Link href="/" aria-label="Omega Nannies home"><Image src="/omega-logo.png" alt="Omega Nannies" width={148} height={50} priority /></Link>
          <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-subtle">{portal}</p>
        </div>
        <div className="flex-1 overflow-y-auto pb-4"><NavLinks nav={nav} /></div>
        <div className="flex items-center gap-3 border-t border-line p-4">
          <Avatar name={user.name} size={36} />
          <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-ink">{user.name}</p><p className="truncate text-[12px] text-muted">{user.email}</p></div>
          <form action={signOutAction}><button className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-sand hover:text-ink" aria-label="Sign out" title="Sign out"><LogOut aria-hidden className="h-[18px] w-[18px]" /></button></form>
        </div>
      </aside>
      <div className="min-w-0 pb-[72px] lg:pb-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur sm:px-8 lg:justify-end lg:bg-cream/80">
          <Link href="/" className="lg:hidden"><Image src="/omega-logo.png" alt="Omega Nannies" width={112} height={38} priority /></Link>
          <div className="flex items-center gap-1">
            {bell}
            <div className="lg:hidden"><MobileNav nav={nav} portal={portal} user={user} /></div>
          </div>
        </header>
        {env.demo && <div role="note" className="border-b border-gold/25 bg-gold-50 px-4 py-1.5 text-center text-[12px] font-medium text-gold-600">Demonstration environment — synthetic data only. No real payments or emails are sent.</div>}
        <main id="main" className="mx-auto max-w-[1200px] animate-in px-4 py-7 sm:px-8 sm:py-9">{children}</main>
        <BottomTabs nav={nav} />
      </div>
    </div>
  );
}
