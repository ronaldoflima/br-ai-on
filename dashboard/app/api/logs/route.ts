import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const LOGS_DIR = join(PROJECT_ROOT, "logs");

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent");
  const date =
    request.nextUrl.searchParams.get("date") ||
    new Date().toISOString().slice(0, 10);
  const limit = parseInt(
    request.nextUrl.searchParams.get("limit") || "100",
    10,
  );

  if (agent) {
    const logFile = join(LOGS_DIR, `${agent}_${date}.jsonl`);
    if (!existsSync(logFile)) {
      return NextResponse.json({ agent, date, entries: [] });
    }
    try {
      const lines = readFileSync(logFile, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line))
        .reverse();
      return NextResponse.json({ agent, date, entries: lines });
    } catch {
      return NextResponse.json(
        { error: "Failed to parse logs" },
        { status: 500 },
      );
    }
  }

  // All agents
  const entries: Array<Record<string, unknown>> = [];
  if (existsSync(LOGS_DIR)) {
    const files = readdirSync(LOGS_DIR).filter((f) =>
      f.endsWith(`_${date}.jsonl`),
    );
    for (const file of files) {
      try {
        const lines = readFileSync(join(LOGS_DIR, file), "utf-8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        entries.push(...lines);
      } catch {
        // skip unparseable files
      }
    }
  }
  entries.sort((a, b) =>
    String(b.timestamp || "").localeCompare(String(a.timestamp || "")),
  );
  return NextResponse.json({ date, entries: entries.slice(0, limit) });
}
