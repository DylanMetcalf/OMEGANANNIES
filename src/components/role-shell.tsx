import type { ReactNode } from "react";
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { PortalShell, type NavItem, type PrimaryAction } from "./shell";
import { familyIdsOf } from "@/lib/bookings";
import { getSetting } from "@/lib/settings";
import { can, isManagement } from "@/lib/permissions";
import { unreadCount, unreadMessages } from "@/lib/queries";
import { nannyOf } from "@/lib/bookings";
import type { CurrentUser } from "@/lib/auth";

/** Role-aware navigation. Visibility here is convenience only — every page and action re-checks permissions. */
export async function RoleShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [notes, msgs] = await Promise.all([unreadCount(user.id), unreadMessages(user.id)]);
  let portal: string, nav: NavItem[], primary: PrimaryAction;
  if (isManagement(user)) {
    portal = "Omega Management";
    nav = [
      { href: "/manage", label: "Overview", icon: "dashboard", tab: true },
      { href: "/manage/bookings", label: "Bookings", icon: "calendar", tab: true },
      { href: "/manage/nannies", label: "Nannies", icon: "users" },
      { href: "/manage/families", label: "Families", icon: "house" },
      { href: "/manage/tasks", label: "Tasks", icon: "tasks" },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs, tab: true },
      ...(can(user, "reports.view") ? [{ href: "/manage/insights", label: "Insights", icon: "chart" }] : []),
      ...(can(user, "settings.manage") || can(user, "reports.view") ? [{ href: "/manage/growth", label: "Referrals & loyalty", icon: "gift" }] : []),
      ...(can(user, "pricing.manage") ? [{ href: "/manage/pricing", label: "Pricing", icon: "tag" }] : []),
      ...(can(user, "reports.view") ? [{ href: "/manage/reports", label: "Reports", icon: "file" }] : []),
      ...(can(user, "content.manage") ? [{ href: "/manage/content", label: "Help content", icon: "book" }] : []),
      { href: "/manage/support", label: "Support & reviews", icon: "help" },
      ...(can(user, "users.manage") || can(user, "audit.view") || can(user, "settings.manage") ? [{ href: "/manage/admin", label: "Administration", icon: "shield" }] : []),
    ];
    const [{ n: newRequests }] = await db.select({ n: count() }).from(s.bookings).where(eq(s.bookings.status, "enquiry"));
    primary = { href: "/manage/bookings?status=enquiry", label: newRequests ? `New requests · ${newRequests}` : "Requests", icon: "inbox" };
  } else if (user.roles.includes("nanny")) {
    portal = "Nanny Portal";
    const me = await nannyOf(user.id);
    const onboarding = me && me.status !== "approved";
    const [{ n: offers }] = me ? await db.select({ n: count() }).from(s.bookings).where(and(eq(s.bookings.nannyId, me.id), eq(s.bookings.nannyResponse, "pending"))) : [{ n: 0 }];
    nav = [
      ...(onboarding ? [{ href: "/nanny/onboarding", label: "Get started", icon: "check" }] : []),
      { href: "/nanny", label: "Today", icon: "home", tab: true },
      { href: "/nanny/bookings", label: "Bookings", icon: "calendar", tab: true },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs, tab: true },
      { href: "/nanny/profile", label: "Profile", icon: "profile" },
      { href: "/nanny/availability", label: "Availability", icon: "check" },
      { href: "/nanny/documents", label: "Documents & vetting", icon: "file" },
      { href: "/nanny/earnings", label: "Engagements", icon: "wallet" },
      { href: "/account", label: "Account & security", icon: "settings" },
      { href: "/help", label: "Help", icon: "help" },
    ];
    primary = onboarding ? { href: "/nanny/onboarding", label: "Finish set-up", icon: "check" }
      : offers ? { href: "/nanny#offers", label: offers === 1 ? "Review offer" : `Review ${offers} offers`, icon: "inbox" } : { href: "/nanny/availability", label: "My availability", icon: "calendarPlus" };
  } else {
    portal = "Family Portal";
    const [familyId] = await familyIdsOf(user.id);
    const [[draft], [{ n: shortlisted }], referral] = familyId ? await Promise.all([
      db.select({ step: s.bookingDrafts.step }).from(s.bookingDrafts).where(and(eq(s.bookingDrafts.familyId, familyId), sql`${s.bookingDrafts.updatedAt} > now() - interval '30 days'`)),
      db.select({ n: count() }).from(s.favourites).where(eq(s.favourites.familyId, familyId)),
      getSetting("referral"),
    ]) : [[], [{ n: 0 }], await getSetting("referral")];
    nav = [
      { href: "/family", label: "Home", icon: "home", tab: true },
      { href: "/family/book/nannies", label: "Find a nanny", icon: "search" },
      { href: "/family/shortlist", label: "Shortlist", icon: "bookmark", badge: shortlisted || undefined, quiet: true },
      { href: "/family/bookings", label: "Bookings", icon: "calendar", tab: true },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs, tab: true },
      { href: "/family/my-family", label: "My Family", icon: "house" },
      { href: "/family/payments", label: "Payments", icon: "card" },
      { href: "/family/documents", label: "Documents", icon: "file" },
      ...(referral.enabled ? [{ href: "/family/rewards", label: "Rewards", icon: "gift" }] : []),
      { href: "/account", label: "Account & privacy", icon: "settings" },
      { href: "/help", label: "Help", icon: "help" },
    ];
    primary = draft && draft.step !== "requirements" ? { href: "/family/book/resume", label: "Continue booking", icon: "arrow" } : { href: "/family/book", label: "Book a nanny", icon: "plus" };
    primary.contextual = [
      { prefix: "/family/book/nannies", href: "/family/shortlist", label: "Shortlist", icon: "bookmark", count: shortlisted },
      { prefix: "/family/shortlist", href: "/family/book/review", label: "Continue", icon: "arrow" },
      { prefix: "/family/book/review", href: "", label: "", icon: "" },
      { prefix: "/family/book", href: "", label: "", icon: "", exact: true }, // step 1 has its own sticky action bar
    ];
  }
  const greeting = primary.label.startsWith("Continue") ? "Your booking is where you left it." : isManagement(user) ? "Here's today's operations overview." : user.roles.includes("nanny") ? "Here's your day at a glance." : "Let's find the right nanny for your family.";
  return <PortalShell portal={portal} nav={nav} user={user} unread={notes} primary={primary} greeting={greeting}>{children}</PortalShell>;
}
