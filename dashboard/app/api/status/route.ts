import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { parseDomainTags } from "../../lib/domain";
import { defaultModel } from "../../lib/cli-backend";
import { nextCronMatch } from "../../lib/utils";

const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const DEFAULTS_DIR = join(AGENTS_DIR, "_defaults");

function listAgentsIn(baseDir: string): { name: string; dir: string }[] {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir)
    .filter((name) => {
      if (name === "shared" || name === "_defaults") return false;
      const d = join(baseDir, name);
      return statSync(d).isDirectory() && existsSync(join(d, "config.yaml"));
    })
    .map((name) => ({ name, dir: join(baseDir, name) }));
}

function getAgentEntries(): { name: string; dir: string }[] {
  const userAgents = listAgentsIn(AGENTS_DIR);
  const defaultAgents = listAgentsIn(DEFAULTS_DIR);
  const seen = new Set(userAgents.map((a) => a.name));
  return [...userAgents, ...defaultAgents.filter((a) => !seen.has(a.name))];
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

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = getAgentEntries();
  const statuses = entries.map(({ name, dir: agentDir }) => {
    const stateDir = join(agentDir, "state");

    let displayName = name;
    let domain: string[] = [];
    let version = "0.0.0";
    let intervalMs = 3600000;
    let scheduleMode = "handoff-only";
    let cronExpr: string | null = null;
    let model = defaultModel();
    const configPath = join(agentDir, "config.yaml");
    if (existsSync(configPath)) {
      try {
        const config = parse(readFileSync(configPath, "utf-8"));
        displayName = config.display_name || name;
        domain = parseDomainTags(config.domain);
        version = config.version || "0.0.0";
        model = config.model || defaultModel();
        const sched = config?.schedule || {};
        scheduleMode = sched.mode || (sched.enabled === true ? "alive" : "handoff-only");
        if (sched.cron) {
          cronExpr = sched.cron;
        }
        if (sched.interval) {
          intervalMs = parseInterval(sched.interval);
        }
      } catch {
        // ignore parse errors
      }
    }

    let heartbeat: string | null = null;
    let agentStatus: string | null = null;
    const hbPath = join(stateDir, "heartbeat.json");
    if (existsSync(hbPath)) {
      try {
        const hb = JSON.parse(readFileSync(hbPath, "utf-8"));
        heartbeat = hb.last_ping || null;
        agentStatus = hb.status || null;
      } catch {
        // ignore parse errors
      }
    }

    let lastRun: string | null = null;
    const schedulePath = join(AGENTS_DIR, "shared", "schedule_state.json");
    if (existsSync(schedulePath)) {
      try {
        const schedule = JSON.parse(readFileSync(schedulePath, "utf-8"));
        lastRun = schedule[name] || null;
      } catch {
        // ignore parse errors
      }
    }

    let objective: string | null = null;
    const objPath = join(stateDir, "current_objective.md");
    if (existsSync(objPath)) {
      try {
        objective = readFileSync(objPath, "utf-8").trim().slice(0, 200);
      } catch {
        // ignore read errors
      }
    }

    const maintFile = `/tmp/agent-${name}-maintenance`;
    let state: "running" | "idle" | "stale" | "maintenance" | "error" = "idle";
    if (existsSync(maintFile)) {
      state = "maintenance";
    } else if (agentStatus === "started") {
      state = "running";
    } else if (heartbeat) {
      const age = Date.now() - new Date(heartbeat).getTime();
      if (age > intervalMs * 3) {
        state = "stale";
      }
    }

    let nextRun: string | null = null;
    if (scheduleMode === "alive") {
      if (cronExpr) {
        nextRun = nextCronMatch(cronExpr).toISOString();
      } else if (lastRun) {
        const next = new Date(new Date(lastRun).getTime() + intervalMs);
        nextRun = next.getTime() > Date.now() ? next.toISOString() : new Date().toISOString();
      }
    }

    return { name, displayName, domain, state, heartbeat, lastRun, nextRun, objective, version, scheduleMode, model };
  });

  return NextResponse.json(statuses);
}
