// Helpers de conexão PG via psql/libpq, compartilhados pelas rotas de
// /api/sessions. O serviço roda com o .env do repo carregado
// (node --env-file=../.env), então PGSERVICE/PGHOST chegam por process.env.
// Fallback: lê PG* do .env do PROJECT_ROOT (mesmo padrão das rotas que leem
// arquivos do repo) e, por último, assume PGSERVICE=braion (~/.pg_service.conf).
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..");

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

function runPsql(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", args, { env: pgEnv() });
    let out = "";
    let err = "";
    // Timeout: PG inacessível pode deixar o psql pendurado; mata o processo e
    // rejeita — a rejeição cai no tratamento de erro de cada rota.
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
    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

export function spawnPsql(sql: string): Promise<string> {
  return runPsql(["-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

// spawnPsqlStdin: SQL via stdin + variáveis psql (-v). OBRIGATÓRIO para texto
// vindo do usuário: psql NÃO interpola -v com -c, e interpolar na string SQL
// seria injeção. Com stdin (-f -), :'var' faz quoting seguro do lado do psql.
export function spawnPsqlStdin(
  sql: string,
  vars: Record<string, string>,
): Promise<string> {
  // -q: com -f, o psql imprime command tags ("INSERT 0 1") mesmo com -t;
  // quiet suprime, deixando só o RETURNING.
  const args = ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  args.push("-f", "-");
  return runPsql(args, sql);
}
