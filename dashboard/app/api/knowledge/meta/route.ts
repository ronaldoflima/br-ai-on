import { NextResponse } from "next/server"
import { readdirSync, readFileSync, existsSync, lstatSync } from "fs"
import { join } from "path"
import { parse } from "yaml"
import { listCollections, defaultCollection } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..")
const AGENTS_DIR = join(PROJECT_ROOT, "agents")
const USER_AGENTS = process.env.BRAION_AGENTS_DIR || join(
  process.env.HOME || "/home/mcpgw",
  ".config", "br-ai-on", "agents"
)

interface AgentMeta {
  agents: string[]
  domains: string[]
  collections: string[]
  default_collection: string
  agent_collections: Record<string, string>
}

function collectAgentMeta(): Omit<AgentMeta, "collections"> {
  const agentSet = new Set<string>()
  const domainSet = new Set<string>()
  const agentCollections: Record<string, string> = {}

  const dirs = [AGENTS_DIR, USER_AGENTS].filter(existsSync)
  for (const dir of dirs) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith("_") || entry === "shared") continue
      const agentDir = join(dir, entry)
      if (!lstatSync(agentDir).isDirectory() && !lstatSync(agentDir).isSymbolicLink()) continue
      const configPath = join(agentDir, "config.yaml")
      if (!existsSync(configPath)) continue
      try {
        const cfg = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
        const name = (cfg.name as string) || entry
        agentSet.add(name)
        const domains = cfg.domain as string[] | undefined
        if (domains) domains.forEach((d) => domainSet.add(d))
        if (cfg.knowledge_collection) {
          agentCollections[name] = cfg.knowledge_collection as string
        }
      } catch {
        agentSet.add(entry)
      }
    }
  }

  return {
    agents: [...agentSet].sort(),
    domains: [...domainSet].sort(),
    default_collection: defaultCollection(),
    agent_collections: agentCollections,
  }
}

export async function GET() {
  try {
    const meta = collectAgentMeta()
    let collections: string[]
    try {
      collections = await listCollections()
    } catch {
      collections = [meta.default_collection]
    }
    return NextResponse.json({ ...meta, collections })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to collect meta: " + String(err) },
      { status: 500 }
    )
  }
}
