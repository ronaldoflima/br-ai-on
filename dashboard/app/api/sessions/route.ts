import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..");
const STALE_MS = 3 * 60 * 1000;

// Uma única invocação de psql devolve as duas tabelas num único JSON.
const QUERY = `SELECT json_build_object(
  'sessions', (
    SELECT coalesce(json_agg(t ORDER BY t.host, t.session, t.window_index, t.pane_index), '[]'::json)
    FROM braion.tmux_sessions t
  ),
  'hosts', (
    SELECT coalesce(json_agg(h ORDER BY h.host), '[]'::json)
    FROM braion.collector_heartbeats h
  )
)`;

interface TmuxPane {
  host: string;
  session: string;
  window_index: number;
  pane_index: number;
  window_name: string | null;
  command: string | null;
  cwd: string | null;
  state: string;
  state_detail: string | null;
  last_output: string | null;
  attached: boolean;
  state_since: string;
  last_seen: string;
}

interface HeartbeatRow {
  host: string;
  last_run: string;
}

// Conexão PG via psql/libpq: o serviço roda com o .env do repo carregado
// (node --env-file=../.env), então PGSERVICE/PGHOST chegam por process.env.
// Fallback: lê PG* do .env do PROJECT_ROOT (mesmo padrão das rotas que leem
// arquivos do repo) e, por último, assume PGSERVICE=braion (~/.pg_service.conf).
function pgVarsFromDotEnv(): Record<string, string> {
  const envPath = join(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      // [^#]* evita capturar comentários inline (PGHOST=x # comment).
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
    // Timeout: PG inacessível pode deixar o psql pendurado; mata o processo e
    // rejeita — a rejeição cai na degradação graciosa do GET (200 + error).
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("psql timeout"));
    }, PSQL_TIMEOUT_MS);
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e); // psql ausente (ENOENT) etc.
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `psql exit ${code}`));
      else resolve(out);
    });
  });
}

export async function GET() {
  // Degradação graciosa: tabela inexistente (42P01), psql ausente ou PG fora do
  // ar → HTTP 200 com listas vazias + error, nunca 500 (não quebra o dashboard).
  try {
    const out = (await spawnPsql(QUERY)).trim();
    const data = out ? JSON.parse(out) : { sessions: [], hosts: [] };
    const sessions: TmuxPane[] = data.sessions || [];
    const hosts = ((data.hosts || []) as HeartbeatRow[]).map((h) => ({
      host: h.host,
      last_run: h.last_run,
      online: Date.now() - new Date(h.last_run).getTime() <= STALE_MS,
    }));
    return NextResponse.json({ sessions, hosts });
  } catch (err) {
    return NextResponse.json({ sessions: [], hosts: [], error: String(err) });
  }
}
