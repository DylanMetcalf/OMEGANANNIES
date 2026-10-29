export type Role = "family" | "nanny" | "ops" | "manager" | "admin";
export const MANAGEMENT_ROLES: Role[] = ["ops", "manager", "admin"];

export const PERMISSIONS = {
  "bookings.view": "View bookings and enquiries",
  "bookings.manage": "Assign, quote, approve, reschedule and cancel bookings",
  "families.view": "View family records",
  "families.manage": "Edit family records and restrictions",
  "nannies.view": "View nanny records",
  "nannies.manage": "Create, invite, edit, approve and suspend nannies",
  "vetting.manage": "Record checks and review private documents",
  "sensitive.view": "View children's medical/allergy details and private documents",
  "pricing.manage": "Edit and publish price books",
  "payments.manage": "Record offline payments, refunds and payment overrides",
  "content.manage": "Edit FAQs, help articles and templates",
  "messages.oversee": "Read conversations for safeguarding and support (audited)",
  "reviews.moderate": "Moderate reviews",
  "reports.view": "View reports and exports",
  "users.manage": "Invite staff, change roles and permissions",
  "audit.view": "View audit log",
  "settings.manage": "Configure integrations and system settings",
} as const;
export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  family: [], nanny: [],
  ops: ["bookings.view", "families.view", "nannies.view"],
  manager: ALL.filter((p) => p !== "users.manage" && p !== "settings.manage"),
  admin: ALL,
};

export type Principal = { id: string; roles: Role[]; permissions: string[]; status: string };

export function permissionsOf(p: Principal): Set<Permission> {
  const s = new Set<Permission>();
  for (const r of p.roles) ROLE_DEFAULTS[r].forEach((x) => s.add(x));
  if (p.roles.some((r) => MANAGEMENT_ROLES.includes(r))) p.permissions.forEach((x) => x in PERMISSIONS && s.add(x as Permission));
  return s;
}
export function can(p: Principal | null | undefined, perm: Permission): boolean {
  return !!p && p.status === "active" && permissionsOf(p).has(perm);
}
export const isManagement = (p: Principal | null | undefined) => !!p && p.roles.some((r) => MANAGEMENT_ROLES.includes(r));
export function homeFor(p: Principal): string {
  if (isManagement(p)) return "/manage";
  if (p.roles.includes("nanny")) return "/nanny";
  return "/family";
}
