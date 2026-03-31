import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "hawkai_session";
const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  if (process.env.DISABLE_AUTH === "true") return NextResponse.next();

  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  const session = req.cookies.get(SESSION_COOKIE);
  if (!session?.value) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.ico|.*\\.svg|.*\\.jpg|.*\\.webp).*)"],
};
