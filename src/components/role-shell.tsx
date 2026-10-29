import type { ReactNode } from "react";
import { PortalShell, type NavItem } from "./shell";
import { can, isManagement } from "@/lib/permissions";
import { unreadCount, unreadMessages } from "@/lib/queries";
import { nannyOf } from "@/lib/bookings";
import type { CurrentUser } from "@/lib/auth";

/** Role-aware navigation. Visibility here is convenience only — every page and action re-checks permissions. */
export async function RoleShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [notes, msgs] = await Promise.all([unreadCount(user.id), unreadMessages(user.id)]);
  let portal: string, nav: NavItem[];
  if (isManagement(user)) {
    portal = "Omega Management";
    nav = [
      { href: "/manage", label: "Overview", icon: "dashboard" },
      { href: "/manage/bookings", label: "Bookings", icon: "calendar" },
      { href: "/manage/nannies", label: "Nannies", icon: "users" },
      { href: "/manage/families", label: "Families", icon: "house" },
      { href: "/manage/tasks", label: "Tasks", icon: "tasks" },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs },
      ...(can(user, "pricing.manage") ? [{ href: "/manage/pricing", label: "Pricing", icon: "tag" }] : []),
      ...(can(user, "reports.view") ? [{ href: "/manage/reports", label: "Reports", icon: "chart" }] : []),
      ...(can(user, "content.manage") ? [{ href: "/manage/content", label: "Help content", icon: "book" }] : []),
      { href: "/manage/support", label: "Support & reviews", icon: "help" },
      ...(can(user, "users.manage") || can(user, "audit.view") || can(user, "settings.manage") ? [{ href: "/manage/admin", label: "Administration", icon: "shield" }] : []),
    ];
  } else if (user.roles.includes("nanny")) {
    portal = "Nanny Portal";
    const me = await nannyOf(user.id);
    const onboarding = me && me.status !== "approved";
    nav = [
      ...(onboarding ? [{ href: "/nanny/onboarding", label: "Get started", icon: "check" }] : []),
      { href: "/nanny", label: "Today", icon: "home" },
      { href: "/nanny/bookings", label: "Bookings", icon: "calendar" },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs },
      { href: "/nanny/profile", label: "Profile", icon: "profile" },
      { href: "/nanny/availability", label: "Availability", icon: "check" },
      { href: "/nanny/documents", label: "Documents & vetting", icon: "file" },
      { href: "/nanny/earnings", label: "Engagements", icon: "wallet" },
      { href: "/account", label: "Account & security", icon: "settings" },
      { href: "/help", label: "Help", icon: "help" },
    ];
  } else {
    portal = "Family Portal";
    nav = [
      { href: "/family", label: "Home", icon: "home" },
      { href: "/family/nannies", label: "Find a nanny", icon: "search" },
      { href: "/family/bookings", label: "Bookings", icon: "calendar" },
      { href: "/messages", label: "Messages", icon: "message", badge: msgs },
      { href: "/family/children", label: "Children", icon: "users" },
      { href: "/family/payments", label: "Payments", icon: "card" },
      { href: "/family/documents", label: "Documents", icon: "file" },
      { href: "/family/profile", label: "Household", icon: "house" },
      { href: "/account", label: "Account & privacy", icon: "settings" },
      { href: "/help", label: "Help", icon: "help" },
    ];
  }
  return <PortalShell portal={portal} nav={nav} user={user} unread={notes}>{children}</PortalShell>;
}
