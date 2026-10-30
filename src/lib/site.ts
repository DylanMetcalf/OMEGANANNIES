/**
 * The public marketing site and the portal are separate domains. Links between them are plain navigations:
 * no tokens or session data ever travel in a URL, and the portal only redirects to its own relative paths.
 */
export const SITE_URL = (process.env.WEBSITE_URL ?? "https://omeganannies.com").replace(/\/$/, "");
export const SITE_LINKS = [
  { label: "Omega Nannies website", href: `${SITE_URL}/` },
  { label: "About us", href: `${SITE_URL}/about` },
  { label: "Our services", href: `${SITE_URL}/rates` },
  { label: "FAQ", href: `${SITE_URL}/faq` },
  { label: "Contact", href: `${SITE_URL}/contact` },
] as const;
/** Website service page slugs ↔ portal service codes (for "Book this service" buttons on the website). */
export const SERVICE_SLUGS: Record<string, string> = {
  "holiday-nanny": "holiday", "live-in-nanny": "live_in", "night-nanny": "night", "event-nanny": "event", "granny-nanny": "granny", "special-needs-nanny": "special_needs",
};

const PORTAL_PREFIXES = ["/family", "/nanny", "/manage", "/account", "/messages", "/notifications", "/help", "/pay"];
/**
 * Accept only a same-origin relative path into a portal area. Rejects absolute and protocol-relative URLs,
 * backslash tricks, control characters and anything outside the portal (open-redirect protection).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw, "https://portal.invalid"); } catch { return null; }
  if (url.origin !== "https://portal.invalid") return null;
  if (!PORTAL_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return null;
  return url.pathname + url.search;
}
/** Whether a role may land on a path (a family link must not drop a nanny into the family portal). */
export function pathFitsRoles(path: string, roles: string[]): boolean {
  if (path.startsWith("/family")) return roles.includes("family");
  if (path.startsWith("/nanny")) return roles.includes("nanny");
  if (path.startsWith("/manage")) return roles.some((r) => ["ops", "manager", "admin"].includes(r));
  return true;
}

export type Intent = "book" | "find" | "login" | "nanny-login" | "account" | "register";
/** Website entry points → portal destinations. Unknown intents fall back to sign-in. */
export function entryPath(intent: string | null, service?: string | null): { path: string; needsFamily: boolean } {
  const svc = service && /^[a-z_-]{2,40}$/.test(service) ? (SERVICE_SLUGS[service] ?? service.replace(/-/g, "_")) : null;
  switch (intent) {
    case "book": return { path: `/family/book${svc ? `?service=${svc}` : ""}`, needsFamily: true };
    case "find": return { path: "/family/book/nannies", needsFamily: true };
    case "account": return { path: "/account", needsFamily: false };
    case "register": return { path: "/register", needsFamily: false };
    default: return { path: "/login", needsFamily: false };
  }
}
