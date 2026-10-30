import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { provider, PROVIDERS, type ProviderId } from "@/lib/calendar/providers";
import { beginOAuth } from "@/lib/calendar/sync";
import { rateLimit } from "@/lib/rate-limit";

/** Start the provider's OAuth consent (PKCE + signed state bound to the signed-in user). */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const u = await getCurrentUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/account?calendar=${q}#calendar`, req.url));
  if (!u) return NextResponse.redirect(new URL("/login?next=%2Faccount", req.url));
  const p = (await params).provider as ProviderId;
  if (!PROVIDERS.includes(p) || !provider(p).configured()) return back("unavailable");
  if (!(await rateLimit(`calendar:connect:${u.id}`, 10, 3600))) return back("busy");
  const { url, cookie } = beginOAuth(u.id, p);
  const res = NextResponse.redirect(url);
  res.cookies.set("omega_cal_oauth", cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/calendar/oauth" });
  return res;
}
