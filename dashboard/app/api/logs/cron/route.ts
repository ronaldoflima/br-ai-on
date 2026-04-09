import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const CRON_LOG = join(PROJECT_ROOT, "logs", "agent-cron.log");

export const dynamic = "force-dynamic";

function parseLogLine(line: string): { timestamp: string; message: string; level: string } | null {
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:]+Z)\]\s*(.+)$/);
  if (!match) return null;
  const message = match[2];
  let level = "info";
  if (message.startsWith("SKIP")) level = "skip";
  else if (message.startsWith("START")) level = "start";
  else if (message.startsWith("PAUSED")) level = "paused";
  else if (message.startsWith("WRAPUP")) level = "wrapup";
  else if (message.startsWith("ERROR") || message.startsWith("FAIL")) level = "error";
  else if (message.includes("Handoff:")) level = "handoff";
  else if (message.includes("Scheduler:")) level = "scheduler";
  else if (message.includes("Alive:")) level = "alive";
  else if (message.includes("Obsidian:")) level = "obsidian";
  else if (message.includes("Ciclo conclu")) level = "cycle";
  return { timestamp: match[1], message, level };
}

export async function GET(request: NextRequest) {
  if (!existsSync(CRON_LOG)) {
    return NextResponse.json({ entries: [], total: 0, page: 1, totalPages: 0 });
  }

  const page = parseInt(request.nextUrl.searchParams.get("page") || "1", 10);
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);
  const search = request.nextUrl.searchParams.get("search") || "";
  const level = request.nextUrl.searchParams.get("level") || "";

  try {
    const raw = readFileSync(CRON_LOG, "utf-8");
    const allLines = raw.trim().split("\n").filter(Boolean);

    let parsed = allLines
      .map(parseLogLine)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (search) {
      const s = search.toLowerCase();
      parsed = parsed.filter((e) => e.message.toLowerCase().includes(s));
    }

    if (level) {
      parsed = parsed.filter((e) => e.level === level);
    }

    parsed.reverse();

    const total = parsed.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const entries = parsed.slice(start, start + limit);

    const stat = statSync(CRON_LOG);

    return NextResponse.json({
      entries,
      total,
      page,
      totalPages,
      fileSize: stat.size,
      lastModified: stat.mtime.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to read cron log" }, { status: 500 });
  }
}
