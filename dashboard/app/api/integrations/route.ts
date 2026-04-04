import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const INTEGRATIONS_FILE = join(PROJECT_ROOT, "config", "integrations.json");

export const dynamic = "force-dynamic";

function readIntegrations() {
  if (!existsSync(INTEGRATIONS_FILE)) {
    return { obsidian_rules: [] };
  }
  try {
    return JSON.parse(readFileSync(INTEGRATIONS_FILE, "utf-8"));
  } catch {
    return { obsidian_rules: [] };
  }
}

export async function GET() {
  return NextResponse.json(readIntegrations());
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const configDir = join(PROJECT_ROOT, "config");
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(INTEGRATIONS_FILE, JSON.stringify(body, null, 2) + "\n");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save integrations: " + String(err) },
      { status: 500 }
    );
  }
}
