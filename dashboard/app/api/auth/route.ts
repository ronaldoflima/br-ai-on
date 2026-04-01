import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/app/lib/totp";
import { cookies } from "next/headers";
import { createSessionToken } from "@/app/lib/session";

const SESSION_COOKIE = "braion_session";
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export async function POST(req: NextRequest) {
  const { code } = await req.json();

  if (!code) {
    return NextResponse.json({ error: "Código obrigatório" }, { status: 400 });
  }

  const secret = process.env.TOTP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "TOTP não configurado. Execute scripts/setup-totp.ts" }, { status: 503 });
  }

  if (!verifyToken(String(code), secret)) {
    return NextResponse.json({ error: "Código inválido ou expirado" }, { status: 401 });
  }

  const token = createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
