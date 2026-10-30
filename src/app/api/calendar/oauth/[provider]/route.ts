import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PROVIDERS, type ProviderId } from "@/lib/calendar/providers";
import { completeOAuth, readOAuthCookie } from "@/lib/calendar/sync";

/** OAuth callback. The state must match the signed cookie for this user; tokens are encrypted before storage. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const p = (await params).provider as ProviderId;
  const done = (q: string) => { const r = NextResponse.redirect(new URL(`/account?calendar=${q}#calendar`, req.url)); r.cookies.delete({ name: "omega_cal_oauth", path: "/api/calendar/oauth" }); return r; };
  const u = await getCurrentUser();
  if (!u || !PROVIDERS.includes(p)) return done("failed");
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return done("denied");
  const st = readOAuthCookie(req.cookies.get("omega_cal_oauth")?.value, u.id, p, sp.get("state"));
  const code = sp.get("code");
  if (!st || !code) return done("failed");
  try { await completeOAuth(u.id, p, code, st.verifier); return done("connected"); } catch { return done("failed"); }
}
