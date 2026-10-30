import { NextResponse, type NextRequest } from "next/server";

/** Referral link: remembers the code for 30 days (httpOnly cookie) and sends the visitor to registration. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const res = NextResponse.redirect(new URL("/register", req.nextUrl.origin));
  if (/^[A-Z0-9]{6,12}$/.test(code)) res.cookies.set("omega_ref", code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 86400, path: "/" });
  return res;
}
