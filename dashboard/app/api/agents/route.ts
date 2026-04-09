import { NextRequest, NextResponse } from "next/server";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { parse, stringify } from "yaml";
import { parseDomainTags } from "../../lib/domain";

const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const DEFAULTS_DIR = join(AGENTS_DIR, "_defaults");

export const dynamic = "force-dynamic";

function listAgentsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (name === "shared" || name === "_defaults") return false;
    const d = join(dir, name);
    return statSync(d).isDirectory() && existsSync(join(d, "config.yaml"));
  });
}

export async function GET() {
  const userAgents = listAgentsIn(AGENTS_DIR).map((name) => ({ name, baseDir: AGENTS_DIR }));
  const defaultAgents = listAgentsIn(DEFAULTS_DIR).map((name) => ({ name, baseDir: DEFAULTS_DIR }));

  const seen = new Set(userAgents.map((a) => a.name));
  const combined = [...userAgents, ...defaultAgents.filter((a) => !seen.has(a.name))];

  const agents = combined.map(({ name, baseDir }) => {
      const configPath = join(baseDir, name, "config.yaml");
      const soulPath = join(baseDir, name, "IDENTITY.md");
      let config: Record<string, unknown> = {};
      try {
        config = parse(readFileSync(configPath, "utf-8"));
      } catch {
        // ignore parse errors
      }
      let soulPreview = "";
      try {
        soulPreview = readFileSync(soulPath, "utf-8")
          .split("\n")
          .slice(0, 5)
          .join("\n");
      } catch {
        // ignore read errors
      }
      const sched = (config.schedule || {}) as Record<string, unknown>;
      const mode = sched.mode || (sched.enabled === true ? "alive" : "handoff-only");
      return {
        name,
        display_name: config.display_name || name,
        domain: parseDomainTags(config.domain),
        version: config.version || "0.0.0",
        schedule_interval: sched.interval || "",
        schedule_mode: mode,
        model: config.model || "claude-sonnet-4-6",
        soul_preview: soulPreview,
        layer: (config.layer as string) || "",
      };
    });

  return NextResponse.json(agents);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, display_name, domain, soul } = body;

    if (!name || !display_name) {
      return NextResponse.json(
        { error: "name and display_name are required" },
        { status: 400 },
      );
    }

    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      return NextResponse.json(
        {
          error:
            "name must be lowercase alphanumeric with hyphens/underscores",
        },
        { status: 400 },
      );
    }

    const agentDir = join(AGENTS_DIR, name);
    if (existsSync(agentDir)) {
      return NextResponse.json(
        { error: "agent already exists" },
        { status: 409 },
      );
    }

    // Create directory structure
    mkdirSync(join(agentDir, "state", "cache"), { recursive: true });
    mkdirSync(join(agentDir, "memory"), { recursive: true });
    mkdirSync(join(agentDir, "handoffs", "inbox"), { recursive: true });
    mkdirSync(join(agentDir, "handoffs", "archive"), { recursive: true });

    // Write config.yaml
    const config = {
      name,

      display_name,
      domain: parseDomainTags(domain),
      version: "0.1.0",
      model: "claude-sonnet-4-6",
      fallback_model: "claude-haiku-4-5",
      schedule: {
        mode: "handoff-only",
        interval: "1h",
      },
      budget: {
        max_tokens_per_session: 50000,
        max_sessions_per_day: 10,
      },
      integrations: {
        notion: { enabled: false },
        telegram: { enabled: true },
      },
    };
    writeFileSync(join(agentDir, "config.yaml"), stringify(config));

    // Write IDENTITY.md
    const soulContent =
      soul ||
      `# IDENTITY — ${display_name}\n\n## Identidade\n\nNome: ${display_name}\nPapel: Agente de ${domain || "proposito geral"}\nDominio: ${domain || ""}\n\n## Personalidade\n\n- (definir)\n\n## Regras de Comportamento\n\n1. Sempre ler estado persistente + memoria semantica antes de agir\n2. Registrar decisoes em decisions.md COM rationale\n3. Nao executar acoes destrutivas sem aprovacao\n`;
    writeFileSync(join(agentDir, "IDENTITY.md"), soulContent);

    // Write initial state files
    writeFileSync(
      join(agentDir, "state", "current_objective.md"),
      "# Objetivo Atual\n\n(nenhum objetivo definido)\n",
    );
    writeFileSync(
      join(agentDir, "state", "decisions.md"),
      "# Decisoes\n\n(nenhuma decisao registrada)\n",
    );
    writeFileSync(
      join(agentDir, "state", "completed_tasks.md"),
      "# Tarefas Concluidas\n\n(nenhuma tarefa concluida)\n",
    );
    writeFileSync(
      join(agentDir, "state", "heartbeat.json"),
      JSON.stringify({ last_ping: null, status: "idle" }, null, 2),
    );
    writeFileSync(
      join(agentDir, "memory", "semantic.md"),
      "# Memoria Semantica\n\n(vazio)\n",
    );
    writeFileSync(join(agentDir, "memory", "episodic.jsonl"), "");
    writeFileSync(join(agentDir, "handoffs", "inbox", ".gitkeep"), "");
    writeFileSync(join(agentDir, "handoffs", "archive", ".gitkeep"), "");

    // Update schedule_state.json
    const schedulePath = join(AGENTS_DIR, "shared", "schedule_state.json");
    try {
      const schedule = JSON.parse(readFileSync(schedulePath, "utf-8"));
      schedule[name] = "1970-01-01T00:00:00Z";
      writeFileSync(schedulePath, JSON.stringify(schedule, null, 2) + "\n");
    } catch {
      // ignore if schedule file doesn't exist
    }

    return NextResponse.json(
      { ok: true, name, message: `Agent ${name} created` },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create agent: " + String(err) },
      { status: 500 },
    );
  }
}
