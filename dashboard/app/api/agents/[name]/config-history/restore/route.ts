// dashboard/app/api/agents/[name]/config-history/restore/route.ts
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { restoreConfigVersion } from "../../../../../lib/config-history";
import { resolveAgentDir } from "../../../../../lib/agents";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);
  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { timestamp } = body;
    if (!timestamp || typeof timestamp !== "string") {
      return NextResponse.json({ error: "timestamp required" }, { status: 400 });
    }

    const { dir: agentDir, isDefault } = resolved;
    const configFile = isDefault ? "config.override.yaml" : "config.yaml";
    const configPath = join(agentDir, configFile);

    let currentContent: string;
    try {
      currentContent = readFileSync(configPath, "utf-8");
    } catch {
      return NextResponse.json({ error: "config file not found" }, { status: 404 });
    }

    const ok = restoreConfigVersion(agentDir, timestamp, currentContent, configPath);
    if (!ok) {
      return NextResponse.json({ error: "versão não encontrada ou erro ao restaurar" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Erro ao restaurar" }, { status: 500 });
  }
}
