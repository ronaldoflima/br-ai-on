import { NextResponse } from "next/server";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const PAUSE_FILE = join(process.cwd(), "..", ".paused");

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ paused: existsSync(PAUSE_FILE) });
}

export async function POST() {
  writeFileSync(PAUSE_FILE, new Date().toISOString());
  return NextResponse.json({ paused: true });
}

export async function DELETE() {
  if (existsSync(PAUSE_FILE)) unlinkSync(PAUSE_FILE);
  return NextResponse.json({ paused: false });
}
