import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const METRICS_DIR = join(PROJECT_ROOT, "metrics");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  if (!DATE_RE.test(today)) {
    return NextResponse.json({ error: "date inválido" }, { status: 400 });
  }
  const metricsFile = join(METRICS_DIR, `${today}.jsonl`);

  if (!existsSync(metricsFile)) {
    return NextResponse.json({
      date: today,
      total_requests: 0,
      sessions: 0,
      handoffs: 0,
      blocked: 0,
      by_agent: [],
    });
  }

  try {
    const lines = readFileSync(metricsFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const sessions = lines.filter((l) => l.action === "session").length;
    const handoffs = lines.filter((l) =>
      l.action === "handoff_sent" ||
      l.action === "handoff_claimed" ||
      l.action === "handoff_processed"
    ).length;
    const blocked = lines.filter((l) =>
      l.status === "blocked" || l.status === "budget_blocked"
    ).length;

    const agentMap = new Map<string, typeof lines>();
    for (const line of lines) {
      const existing = agentMap.get(line.agent) || [];
      existing.push(line);
      agentMap.set(line.agent, existing);
    }

    const byAgent = Array.from(agentMap.entries()).map(([agent, entries]) => ({
      agent,
      requests: entries.length,
      success: entries.filter((e) => e.status === "success").length,
      errors: entries.filter((e) => e.status === "error").length,
      avg_latency_ms: entries.reduce((sum, e) => sum + (e.latency_ms || 0), 0) / entries.length,
    }));

    return NextResponse.json({
      date: today,
      total_requests: lines.length,
      sessions,
      handoffs,
      blocked,
      by_agent: byAgent,
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse metrics" }, { status: 500 });
  }
}