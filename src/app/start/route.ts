import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";
import { entryPath, pathFitsRoles } from "@/lib/site";

/**
 * Single entry point for links from omeganannies.com, e.g.
 *   /start?intent=book&service=holiday-nanny   /start?intent=find   /start?intent=login   /start?intent=nanny-login
 * Signed-in users go straight to the right place; others sign in (or register) and are returned afterwards.
 * Optional ?ref=CODE records a referral attribution cookie (only used if the programme is active).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { path, needsFamily } = entryPath(sp.get("intent"), sp.get("service"));
  const u = await getCurrentUser();
  const to = (p: string) => new URL(p, req.nextUrl.origin);
  let res: NextResponse;
  if (u) res = NextResponse.redirect(to(needsFamily && !pathFitsRoles(path, u.roles) ? homeFor(u) : path === "/login" || path === "/register" ? homeFor(u) : path));
  else if (path === "/login" || path === "/register" || path === "/account") res = NextResponse.redirect(to(path === "/account" ? "/login?next=%2Faccount" : path));
  else res = NextResponse.redirect(to(`/login?next=${encodeURIComponent(path)}`));
  const ref = sp.get("ref");
  if (ref && /^[A-Z0-9]{6,12}$/.test(ref)) res.cookies.set("omega_ref", ref, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 86400, path: "/" });
  return res;
}
