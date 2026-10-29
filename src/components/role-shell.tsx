import type { ReactNode } from "react";
import { PortalShell, type NavItem } from "./shell";
import { can, isManagement } from "@/lib/permissions";
import { unreadCount, unreadMessages } from "@/lib/queries";
import type { CurrentUser } from "@/lib/auth";

export async function RoleShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [notes, msgs] = await Promise.all([unreadCount(user.id), unreadMessages(user.id)]);
  let portal: string, nav: NavItem[];
  if (isManagement(user)) {
    portal = "Omega Management";
    nav = [
      { href: "/manage", label: "Overview" },
      { href: "/manage/bookings", label: "Bookings" },
      { href: "/manage/nannies", label: "Nannies" },
      { href: "/manage/families", label: "Families" },
      { href: "/messages", label: "Messages", badge: msgs },
      ...(can(user, "pricing.manage") ? [{ href: "/manage/pricing", label: "Pricing" }] : []),
      ...(can(user, "reports.view") ? [{ href: "/manage/reports", label: "Reports" }] : []),
      ...(can(user, "content.manage") ? [{ href: "/manage/content", label: "Help content" }] : []),
      { href: "/manage/support", label: "Support & reviews" },
      ...(can(user, "users.manage") || can(user, "audit.view") ? [{ href: "/manage/admin", label: "Administration" }] : []),
    ];
  } else if (user.roles.includes("nanny")) {
    portal = "Nanny Portal";
    nav = [
      { href: "/nanny", label: "Today" }, { href: "/nanny/bookings", label: "My bookings" }, { href: "/nanny/availability", label: "Availability" },
      { href: "/nanny/profile", label: "My profile" }, { href: "/nanny/documents", label: "Documents" }, { href: "/messages", label: "Messages", badge: msgs },
      { href: "/nanny/earnings", label: "Engagements" }, { href: "/help", label: "Help" },
    ];
  } else {
    portal = "Family Portal";
    nav = [
      { href: "/family", label: "Home" }, { href: "/family/nannies", label: "Find a nanny" }, { href: "/family/bookings", label: "Bookings" },
      { href: "/family/children", label: "Children" }, { href: "/messages", label: "Messages", badge: msgs }, { href: "/family/payments", label: "Payments" },
      { href: "/family/profile", label: "Household" }, { href: "/family/settings", label: "Settings" }, { href: "/help", label: "Help" },
    ];
  }
  return <PortalShell portal={portal} nav={nav} user={user} unread={notes}>{children}</PortalShell>;
}
