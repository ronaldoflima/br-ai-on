import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { validateAgentConfig } from "../../../lib/config-validator";
import { parseDomainTags } from "../../../lib/domain";
import { readMergedConfig } from "../../../lib/config-merge";
import { resolveAgentDir } from "../../../lib/agents";
import { saveConfigToHistory } from "../../../lib/config-history";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);

  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const { dir: agentDir, isDefault } = resolved;

  let config: Record<string, unknown> = {};
  let configRaw = "";
  let hasOverride = false;

  if (isDefault) {
    const merged = readMergedConfig(agentDir);
    config = merged.config;
    configRaw = merged.configRaw;
    hasOverride = merged.hasOverride;
  } else {
    const configPath = join(agentDir, "config.yaml");
    if (existsSync(configPath)) {
      configRaw = readFileSync(configPath, "utf-8");
      try {
        config = parse(configRaw);
      } catch {
        // ignore parse errors
      }
    }
  }

  let soul = "";
  const soulPath = join(agentDir, "IDENTITY.md");
  if (existsSync(soulPath)) {
    soul = readFileSync(soulPath, "utf-8");
  }

  let objective = "";
  const objPath = join(agentDir, "state", "current_objective.md");
  if (existsSync(objPath)) {
    objective = readFileSync(objPath, "utf-8");
  }

  let decisions = "";
  const decPath = join(agentDir, "state", "decisions.md");
  if (existsSync(decPath)) {
    decisions = readFileSync(decPath, "utf-8");
  }

  let semantic = "";
  const semPath = join(agentDir, "memory", "semantic.md");
  if (existsSync(semPath)) {
    semantic = readFileSync(semPath, "utf-8");
  }

  let heartbeat: Record<string, unknown> = {};
  const hbPath = join(agentDir, "state", "heartbeat.json");
  if (existsSync(hbPath)) {
    try {
      heartbeat = JSON.parse(readFileSync(hbPath, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }

  let episodic: Array<Record<string, unknown>> = [];
  const epiPath = join(agentDir, "memory", "episodic.jsonl");
  if (existsSync(epiPath)) {
    try {
      episodic = readFileSync(epiPath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .reverse()
        .slice(0, 50);
    } catch {
      // ignore parse errors
    }
  }

  config.domain = parseDomainTags(config.domain);

  return NextResponse.json({
    name,
    config,
    configRaw,
    soul,
    objective,
    decisions,
    semantic,
    episodic,
    heartbeat,
    isDefault,
    hasOverride,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);

  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const { dir: agentDir, isDefault } = resolved;

  try {
    const body = await request.json();

    if (body.config !== undefined) {
      const result = validateAgentConfig(body.config);
      if (!result.valid) {
        return NextResponse.json({ error: "Config inválida", errors: result.errors }, { status: 422 });
      }
      const targetFile = isDefault ? "config.override.yaml" : "config.yaml";
      const targetPath = join(agentDir, targetFile);
      if (existsSync(targetPath)) {
        try {
          saveConfigToHistory(agentDir, readFileSync(targetPath, "utf-8"));
        } catch {
          // history is best-effort — config write proceeds regardless
        }
      }
      writeFileSync(targetPath, body.config, "utf-8");
    }
    if (body.soul !== undefined) {
      writeFileSync(join(agentDir, "IDENTITY.md"), body.soul);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to update agent" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);

  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const overrideOnly = searchParams.get("override") === "true";

  try {
    if (overrideOnly) {
      const overridePath = join(resolved.dir, "config.override.yaml");
      if (!existsSync(overridePath)) {
        return NextResponse.json({ error: "override not found" }, { status: 404 });
      }
      rmSync(overridePath);
    } else {
      rmSync(resolved.dir, { recursive: true, force: true });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete agent" },
      { status: 500 },
    );
  }
}
