import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const METRICS_DIR = join(PROJECT_ROOT, "metrics");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const metricsFile = join(METRICS_DIR, `${today}.jsonl`);

  if (!existsSync(metricsFile)) {
    return NextResponse.json({
      date: today,
      total_requests: 0,
      success: 0,
      errors: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      avg_latency_ms: 0,
      by_agent: [],
    });
  }

  try {
    const lines = readFileSync(metricsFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const success = lines.filter((l) => l.status === "success").length;
    const errors = lines.filter((l) => l.status === "error").length;
    const avgLatency = lines.length > 0
      ? lines.reduce((sum, l) => sum + (l.latency_ms || 0), 0) / lines.length
      : 0;

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
      success,
      errors,
      avg_latency_ms: avgLatency,
      by_agent: byAgent,
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse metrics" }, { status: 500 });
  }
}