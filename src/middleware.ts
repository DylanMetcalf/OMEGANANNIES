import { NextResponse, type NextRequest } from "next/server";

/** Fast pre-check only: requests to portal areas without a session cookie get a real 307 to /login.
 *  Authorisation is always enforced server-side in each page, action and route (requireUser/assertUser). */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("omega_session")) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(next)}`; // validated by safeNext() after sign-in
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/family/:path*", "/nanny/:path*", "/manage/:path*", "/messages/:path*", "/pay/:path*"] };
