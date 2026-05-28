import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const METRICS_DIR = join(PROJECT_ROOT, "metrics");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "7"), 30);

  const result: Array<{
    date: string;
    requests: number;
    sessions: number;
    handoffs: number;
    blocked: number;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = join(METRICS_DIR, `${dateStr}.jsonl`);

    if (!existsSync(filePath)) {
      result.push({ date: dateStr, requests: 0, sessions: 0, handoffs: 0, blocked: 0 });
      continue;
    }

    try {
      const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const sessions = lines.filter((l) => l.action === "session").length;
      const handoffs = lines.filter((l) =>
        l.action === "handoff_sent" ||
        l.action === "handoff_claimed" ||
        l.action === "handoff_processed"
      ).length;
      const blocked = lines.filter((l) =>
        l.status === "blocked" || l.status === "budget_blocked"
      ).length;

      result.push({ date: dateStr, requests: lines.length, sessions, handoffs, blocked });
    } catch {
      result.push({ date: dateStr, requests: 0, sessions: 0, handoffs: 0, blocked: 0 });
    }
  }

  return NextResponse.json(result);
}
