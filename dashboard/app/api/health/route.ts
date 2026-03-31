import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";

import { join } from "path";
import { parse } from "yaml";

const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
export const dynamic = "force-dynamic";

export async function GET() {
  let agentsHealthy = 0;
  let agentsTotal = 0;
  let pendingHandoffs = 0;

  try {
    const dirs = readdirSync(AGENTS_DIR).filter((name) => {
      if (name === "shared") return false;
      const dir = join(AGENTS_DIR, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "config.yaml"));
    });

    agentsTotal = dirs.length;

    for (const name of dirs) {
      const hbPath = join(AGENTS_DIR, name, "state", "heartbeat.json");
      if (existsSync(hbPath)) {
        try {
          const hb = JSON.parse(readFileSync(hbPath, "utf-8"));
          const lastPing = hb.last_ping ? new Date(hb.last_ping).getTime() : 0;
          const configPath = join(AGENTS_DIR, name, "config.yaml");
          let intervalMs = 3600000; // default 1h
          if (existsSync(configPath)) {
            const config = parse(readFileSync(configPath, "utf-8"));
            const interval = config?.schedule?.interval || "1h";
            intervalMs = parseInterval(interval);
          }
          const age = Date.now() - lastPing;
          // Consider healthy if last ping within 3x the interval
          if (age < intervalMs * 3) {
            agentsHealthy++;
          }
        } catch {
          // parse error = not healthy
        }
      }

      // Count pending handoffs
      const inboxDir = join(AGENTS_DIR, name, "handoffs", "inbox");
      if (existsSync(inboxDir)) {
        try {
          const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
          pendingHandoffs += files.length;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    agents_healthy: agentsHealthy,
    agents_total: agentsTotal,
    pending_handoffs: pendingHandoffs,
  });
}

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(m|min|h|hour|d|day|w|week)/i);
  if (!match) return 3600000;
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("m")) return val * 60000;
  if (unit.startsWith("h")) return val * 3600000;
  if (unit.startsWith("d")) return val * 86400000;
  if (unit.startsWith("w")) return val * 604800000;
  return 3600000;
}
