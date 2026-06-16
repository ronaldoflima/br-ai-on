import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..");

// Fila de prioridades (fase 3): espelho do vault Obsidian gerado pelo
// queue_sync.py. done fica no fim (rank NULL) para auditoria de status.
const QUERY = `SELECT coalesce(json_agg(t ORDER BY t.rank NULLS LAST, t.task_key), '[]'::json)
FROM braion.task_queue t`;

export interface QueueTask {
  task_key: string;
  title: string;
  status: string;
  prioridade: string | null;
  score: number;
  rank: number | null;
  projeto: string | null;
  due: string | null;
  origem: string | null;
  source_path: string;
  payload: Record<string, unknown> | null;
  updated_at: string;
}

// Mesma estratégia de conexão da /api/sessions: env do serviço → .env do
// repo → PGSERVICE=braion.
function pgVarsFromDotEnv(): Record<string, string> {
  const envPath = join(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^\s*(PG[A-Z]+)\s*=\s*([^#]*)/);
      if (match) vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // ignore read errors
  }
  return vars;
}

function pgEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.PGSERVICE && !env.PGHOST) {
    Object.assign(env, pgVarsFromDotEnv());
  }
  if (!env.PGSERVICE && !env.PGHOST) {
    env.PGSERVICE = "braion";
  }
  return env;
}

const PSQL_TIMEOUT_MS = 10_000;

function spawnPsql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", ["-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      env: pgEnv(),
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("psql timeout"));
    }, PSQL_TIMEOUT_MS);
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `psql exit ${code}`));
      else resolve(out);
    });
  });
}

export async function GET() {
  // Degradação graciosa: tabela inexistente (42P01), psql ausente ou PG fora
  // → HTTP 200 com lista vazia + error, nunca 500.
  try {
    const out = (await spawnPsql(QUERY)).trim();
    const tasks: QueueTask[] = out ? JSON.parse(out) : [];
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ tasks: [], error: String(err) });
  }
}
