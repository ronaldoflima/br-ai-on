import { readFileSync } from "fs"
import { join } from "path"
import { parse } from "yaml"
import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  KnowledgeSearchFilters,
  KnowledgeListFilters,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
} from "@/app/lib/types"

interface KnowledgeConfig {
  qdrant_url: string
  ollama_url: string
  embedding_model: string
  embedding_dimensions: number
  collection_name: string
  dashboard_url: string
}

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..")

let _config: KnowledgeConfig | null = null

export function loadConfig(): KnowledgeConfig {
  if (_config) return _config
  const configPath = join(PROJECT_ROOT, "config", "knowledge.yaml")
  const raw = readFileSync(configPath, "utf-8")
  _config = parse(raw) as KnowledgeConfig
  return _config
}

let _collectionReady = false

export async function ensureCollection(): Promise<void> {
  if (_collectionReady) return
  const cfg = loadConfig()
  const url = `${cfg.qdrant_url}/collections/${cfg.collection_name}`

  const check = await fetch(url)
  if (check.ok) {
    _collectionReady = true
    return
  }

  await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vectors: {
        size: cfg.embedding_dimensions,
        distance: "Cosine",
      },
    }),
  })

  const indexes = ["agent", "domain", "type", "source"]
  for (const field of indexes) {
    await fetch(`${url}/index`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field_name: field,
        field_schema: "Keyword",
      }),
    })
  }

  _collectionReady = true
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const cfg = loadConfig()
  const res = await fetch(`${cfg.ollama_url}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.embedding_model, input: text }),
  })
  if (!res.ok) {
    throw new Error(`Ollama embedding failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.embeddings[0]
}

function buildQdrantFilter(filters: KnowledgeSearchFilters) {
  const must: Record<string, unknown>[] = []
  if (filters.agent) {
    must.push({ key: "agent", match: { value: filters.agent } })
  }
  if (filters.domain) {
    must.push({ key: "domain", match: { value: filters.domain } })
  }
  if (filters.type) {
    must.push({ key: "type", match: { value: filters.type } })
  }
  return must.length > 0 ? { must } : undefined
}

function pointToEntry(point: Record<string, unknown>): KnowledgeEntry {
  const p = point.payload as Record<string, unknown>
  return {
    id: String(point.id),
    text: p.text as string,
    agent: p.agent as string,
    domain: p.domain as string[],
    type: p.type as KnowledgeEntry["type"],
    source: p.source as KnowledgeEntry["source"],
    created_at: p.created_at as string,
    updated_at: p.updated_at as string,
    metadata: (p.metadata as Record<string, unknown>) || {},
  }
}

export async function createEntry(input: CreateKnowledgeInput): Promise<string> {
  await ensureCollection()
  const cfg = loadConfig()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const vector = await generateEmbedding(input.text)

  await fetch(`${cfg.qdrant_url}/collections/${cfg.collection_name}/points`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: [
        {
          id,
          vector,
          payload: {
            text: input.text,
            agent: input.agent,
            domain: input.domain,
            type: input.type,
            source: input.source,
            created_at: now,
            updated_at: now,
            metadata: input.metadata || {},
          },
        },
      ],
    }),
  })

  return id
}

export async function getEntry(id: string): Promise<KnowledgeEntry | null> {
  await ensureCollection()
  const cfg = loadConfig()
  const res = await fetch(
    `${cfg.qdrant_url}/collections/${cfg.collection_name}/points/${id}`
  )
  if (!res.ok) return null
  const data = await res.json()
  return pointToEntry(data.result)
}

export async function updateEntry(id: string, input: UpdateKnowledgeInput): Promise<void> {
  await ensureCollection()
  const cfg = loadConfig()
  const existing = await getEntry(id)
  if (!existing) throw new Error(`Entry ${id} not found`)

  const updated = {
    text: input.text ?? existing.text,
    agent: input.agent ?? existing.agent,
    domain: input.domain ?? existing.domain,
    type: input.type ?? existing.type,
    source: existing.source,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
    metadata: input.metadata ?? existing.metadata,
  }

  const vector = input.text ? await generateEmbedding(updated.text) : await generateEmbedding(existing.text)

  await fetch(`${cfg.qdrant_url}/collections/${cfg.collection_name}/points`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: [{ id, vector, payload: updated }],
    }),
  })
}

export async function deleteEntry(id: string): Promise<void> {
  await ensureCollection()
  const cfg = loadConfig()
  await fetch(
    `${cfg.qdrant_url}/collections/${cfg.collection_name}/points/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: [id] }),
    }
  )
}

export async function searchEntries(
  query: string,
  filters?: KnowledgeSearchFilters,
  limit = 10
): Promise<KnowledgeSearchResult[]> {
  await ensureCollection()
  const cfg = loadConfig()
  const vector = await generateEmbedding(query)

  const body: Record<string, unknown> = {
    vector,
    limit,
    with_payload: true,
  }
  const filter = filters ? buildQdrantFilter(filters) : undefined
  if (filter) body.filter = filter

  const res = await fetch(
    `${cfg.qdrant_url}/collections/${cfg.collection_name}/points/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  const data = await res.json()
  return (data.result || []).map((pt: Record<string, unknown>) => ({
    ...pointToEntry(pt),
    score: pt.score as number,
  }))
}

export async function listEntries(
  filters?: KnowledgeListFilters,
  limit = 20,
  offset?: string
): Promise<{ entries: KnowledgeEntry[]; next_offset: string | null }> {
  await ensureCollection()
  const cfg = loadConfig()

  const body: Record<string, unknown> = {
    limit,
    with_payload: true,
    with_vector: false,
  }
  if (offset) body.offset = offset
  const filter = filters ? buildQdrantFilter(filters) : undefined
  if (filter) body.filter = filter

  const res = await fetch(
    `${cfg.qdrant_url}/collections/${cfg.collection_name}/points/scroll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  const data = await res.json()
  const entries = (data.result?.points || []).map(pointToEntry)
  return { entries, next_offset: data.result?.next_page_offset ?? null }
}
