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
    success: number;
    errors: number;
    avg_latency_ms: number;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = join(METRICS_DIR, `${dateStr}.jsonl`);

    if (!existsSync(filePath)) {
      result.push({ date: dateStr, requests: 0, success: 0, errors: 0, avg_latency_ms: 0 });
      continue;
    }

    try {
      const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const success = lines.filter((l) => l.status === "success").length;
      const errors = lines.filter((l) => l.status === "error").length;
      const avgLat = lines.length > 0 ? lines.reduce((s, l) => s + (l.latency_ms || 0), 0) / lines.length : 0;

      result.push({ date: dateStr, requests: lines.length, success, errors, avg_latency_ms: avgLat });
    } catch {
      result.push({ date: dateStr, requests: 0, success: 0, errors: 0, avg_latency_ms: 0 });
    }
  }

  return NextResponse.json(result);
}
