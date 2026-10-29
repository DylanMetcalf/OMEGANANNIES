"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3, Bell, BookOpen, CalendarDays, ClipboardCheck, CreditCard, FileText, HeartHandshake, Home, LayoutDashboard,
  LifeBuoy, ListChecks, Menu, MessageSquare, Search, Settings, ShieldCheck, Tag, UserRound, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import type { NavItem } from "./shell";
import { signOutAction } from "@/app/(auth)/actions";

const ICONS: Record<string, LucideIcon> = {
  home: Home, search: Search, calendar: CalendarDays, users: Users, message: MessageSquare, card: CreditCard, house: HeartHandshake,
  settings: Settings, help: LifeBuoy, dashboard: LayoutDashboard, file: FileText, tag: Tag, chart: BarChart3, book: BookOpen,
  shield: ShieldCheck, profile: UserRound, wallet: Wallet, tasks: ListChecks, check: ClipboardCheck, bell: Bell,
};
export const Icon = ({ name, className = "h-[18px] w-[18px]" }: { name: string; className?: string }) => {
  const C = ICONS[name] ?? Home;
  return <C aria-hidden className={className} strokeWidth={1.8} />;
};

/** Portal roots ("/family", "/nanny", "/manage") match exactly; deeper links also match their sub-pages. */
function isActive(path: string, href: string) {
  return href.split("/").length <= 2 ? path === href : path === href || path.startsWith(href + "/");
}
/** Shows a subtle pending indicator while a navigation is in flight (no global loading boundary needed). */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`ml-auto h-1.5 w-1.5 rounded-full bg-gold transition-opacity ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} />;
}

export function NavLinks({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {nav.map((n) => {
        const on = isActive(path, n.href);
        return (
          <Link key={n.href} href={n.href} prefetch={false} onClick={onNavigate} aria-current={on ? "page" : undefined}
            className={`group flex min-h-[40px] items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] font-medium transition-colors ${on ? "bg-navy-50 text-navy" : "text-muted hover:bg-sand hover:text-ink"}`}>
            <Icon name={n.icon} className={`h-[18px] w-[18px] ${on ? "text-navy" : "text-subtle group-hover:text-ink"}`} />
            <span className="flex-1">{n.label}</span>
            {n.badge ? <span className="rounded-full bg-navy px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={`${n.badge} unread`}>{n.badge}</span> : <Pending />}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone navigation: a bottom tab bar for the four primary destinations plus a "More" sheet. */
export function MobileNav({ nav, portal, user }: { nav: NavItem[]; portal: string; user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const primary = nav.slice(0, 4);
  return (
    <>
      <button className="btn-ghost btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu aria-hidden className="h-5 w-5" /><span className="sr-only sm:not-sr-only">Menu</span></button>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {primary.map((n) => {
          const on = isActive(path, n.href);
          return (
            <Link key={n.href} href={n.href} prefetch={false} aria-current={on ? "page" : undefined} className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? "text-navy" : "text-muted"}`}>
              <Icon name={n.icon} className="h-5 w-5" />{n.label.split(" ")[0]}
              {!!n.badge && <span className="absolute right-[28%] top-2 h-2 w-2 rounded-full bg-gold" aria-label={`${n.badge} unread`} />}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"><Menu aria-hidden className="h-5 w-5" />More</button>
      </nav>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-label="Navigation" className="m-0 ml-auto h-full max-h-none w-[86%] max-w-[340px] bg-surface p-0 shadow-[var(--shadow-pop)] open:animate-in">
        <div className="flex h-full flex-col pb-6">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div><p className="eyebrow">{portal}</p><p className="text-[14px] font-medium text-ink">{user.name}</p></div>
            <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu"><X aria-hidden className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto py-3"><NavLinks nav={nav} onNavigate={() => setOpen(false)} /></div>
          <form action={signOutAction} className="px-5"><button className="btn-secondary w-full">Sign out</button></form>
        </div>
      </dialog>
    </>
  );
}
