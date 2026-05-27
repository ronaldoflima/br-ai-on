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
import { readMergedConfig } from "../../lib/config-merge";
import { defaultModel, fallbackModel } from "../../lib/cli-backend";

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
      const agentDir = join(baseDir, name);
      const soulPath = join(agentDir, "IDENTITY.md");
      const isDefault = baseDir === DEFAULTS_DIR;
      let config: Record<string, unknown> = {};
      if (isDefault) {
        ({ config } = readMergedConfig(agentDir));
      } else {
        try {
          config = parse(readFileSync(join(agentDir, "config.yaml"), "utf-8"));
        } catch {
          // ignore parse errors
        }
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
      const domainTags = parseDomainTags(config.domain);
      const _searchText = [
        name,
        config.display_name || name,
        ...domainTags,
        config.model || "",
        (config.layer as string) || "",
        config.version || "",
        sched.mode || "",
        sched.interval || "",
        ...(Array.isArray(config.capabilities) ? config.capabilities : []),
        typeof config.working_directory === "object" && config.working_directory
          ? [(config.working_directory as Record<string, unknown>).primary || "", ...((config.working_directory as Record<string, unknown>).additional as string[] || [])].join(" ")
          : config.working_directory || "",
        config.fallback_model || "",
      ].filter(Boolean).join(" ").toLowerCase();

      return {
        name,
        display_name: config.display_name || name,
        domain: domainTags,
        version: config.version || "0.0.0",
        schedule_interval: sched.interval || "",
        schedule_mode: mode,
        model: config.model || defaultModel(),
        soul_preview: soulPreview,
        layer: (config.layer as string) || "",
        _searchText,
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
      model: defaultModel(),
      fallback_model: fallbackModel(),
      schedule: {
        mode: "handoff-only",
        interval: "1h",
      },
      budget: {
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

    // Write initial state directories (rotative daily files)
    const today = new Date().toISOString().slice(0, 10);
    for (const sub of ["current_objective", "decisions", "completed_tasks"]) {
      mkdirSync(join(agentDir, "state", sub), { recursive: true });
    }
    writeFileSync(
      join(agentDir, "state", "current_objective", `${today}.md`),
      "# Objetivo Atual\n\n(nenhum objetivo definido)\n",
    );
    writeFileSync(
      join(agentDir, "state", "decisions", `${today}.md`),
      "# Decisoes\n\n(nenhuma decisao registrada)\n",
    );
    writeFileSync(
      join(agentDir, "state", "completed_tasks", `${today}.md`),
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
