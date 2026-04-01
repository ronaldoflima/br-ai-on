import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "braion_session";
const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  if (process.env.DISABLE_AUTH === "true") {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  const session = req.cookies.get(SESSION_COOKIE);
  if (!session?.value) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Validate the signed session token structure and expiration
  const token = session.value;
  const parts = token.split(".");
  if (parts.length !== 2) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const [encoded] = parts;
  try {
    const payload = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now || !payload.sid) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
  } catch {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.ico|.*\\.svg|.*\\.jpg|.*\\.webp).*)"],
};
