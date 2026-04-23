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
  default_collection: string
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

export function defaultCollection(): string {
  return loadConfig().default_collection
}

const _readyCollections = new Set<string>()

export async function ensureCollection(collection?: string): Promise<string> {
  const cfg = loadConfig()
  const col = collection || cfg.default_collection
  if (_readyCollections.has(col)) return col

  const url = `${cfg.qdrant_url}/collections/${col}`

  const check = await fetch(url)
  if (check.ok) {
    _readyCollections.add(col)
    return col
  }

  const createRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vectors: {
        size: cfg.embedding_dimensions,
        distance: "Cosine",
      },
    }),
  })
  if (!createRes.ok) throw new Error("Failed to create collection: " + await createRes.text())

  const keywordIndexes = ["agent", "domain", "type", "source"]
  for (const field of keywordIndexes) {
    const idxRes = await fetch(`${url}/index`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field_name: field,
        field_schema: "Keyword",
      }),
    })
    if (!idxRes.ok) throw new Error(`Failed to create index ${field}: ` + await idxRes.text())
  }

  const textIdxRes = await fetch(`${url}/index`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field_name: "text",
      field_schema: {
        type: "text",
        tokenizer: "multilingual",
        min_token_len: 2,
        max_token_len: 20,
      },
    }),
  })
  if (!textIdxRes.ok) throw new Error("Failed to create text index: " + await textIdxRes.text())

  _readyCollections.add(col)
  return col
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
    text: (p.text as string) || "",
    agent: (p.agent as string) || "",
    domain: Array.isArray(p.domain) ? p.domain as string[] : [],
    type: (p.type as KnowledgeEntry["type"]) || "fact",
    source: (p.source as KnowledgeEntry["source"]) || "manual",
    created_at: (p.created_at as string) || "",
    updated_at: (p.updated_at as string) || "",
    metadata: (p.metadata as Record<string, unknown>) || {},
  }
}

export async function createEntry(input: CreateKnowledgeInput, collection?: string): Promise<string> {
  const col = await ensureCollection(collection)
  const cfg = loadConfig()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const vector = await generateEmbedding(input.text)

  const res = await fetch(`${cfg.qdrant_url}/collections/${col}/points`, {
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
  if (!res.ok) throw new Error("Failed to upsert entry: " + await res.text())

  return id
}

export async function getEntry(id: string, collection?: string): Promise<KnowledgeEntry | null> {
  const col = await ensureCollection(collection)
  const cfg = loadConfig()
  const res = await fetch(
    `${cfg.qdrant_url}/collections/${col}/points/${id}`
  )
  if (!res.ok) return null
  const data = await res.json()
  return pointToEntry(data.result)
}

export async function updateEntry(id: string, input: UpdateKnowledgeInput, collection?: string): Promise<void> {
  const col = await ensureCollection(collection)
  const cfg = loadConfig()
  const existing = await getEntry(id, collection)
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

  const res = await fetch(`${cfg.qdrant_url}/collections/${col}/points`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: [{ id, vector, payload: updated }],
    }),
  })
  if (!res.ok) throw new Error("Failed to upsert entry: " + await res.text())
}

export async function deleteEntry(id: string, collection?: string): Promise<void> {
  const col = await ensureCollection(collection)
  const cfg = loadConfig()
  const res = await fetch(
    `${cfg.qdrant_url}/collections/${col}/points/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: [id] }),
    }
  )
  if (!res.ok) throw new Error("Failed to delete entry: " + await res.text())
}

const SEMANTIC_THRESHOLD = 0.6

async function fulltextSearch(
  query: string,
  col: string,
  filters?: KnowledgeSearchFilters,
  limit = 10
): Promise<KnowledgeSearchResult[]> {
  const cfg = loadConfig()
  const must: Record<string, unknown>[] = [
    { key: "text", match: { text: query } },
  ]
  const filterConditions = filters ? buildQdrantFilter(filters) : undefined
  if (filterConditions) must.push(...filterConditions.must)

  const body: Record<string, unknown> = {
    filter: { must },
    limit,
    with_payload: true,
    with_vector: false,
  }

  const res = await fetch(
    `${cfg.qdrant_url}/collections/${col}/points/scroll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.result?.points || []).map((pt: Record<string, unknown>) => ({
    ...pointToEntry(pt),
    score: 0,
    match: "fulltext" as const,
  }))
}

export async function searchEntries(
  query: string,
  filters?: KnowledgeSearchFilters,
  limit = 10,
  collection?: string
): Promise<KnowledgeSearchResult[]> {
  const col = await ensureCollection(collection)
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
    `${cfg.qdrant_url}/collections/${col}/points/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) throw new Error("Failed to search entries: " + await res.text())
  const data = await res.json()
  const results: KnowledgeSearchResult[] = (data.result || []).map((pt: Record<string, unknown>) => ({
    ...pointToEntry(pt),
    score: pt.score as number,
  }))

  const bestScore = results.length > 0 ? results[0].score : 0
  if (bestScore < SEMANTIC_THRESHOLD) {
    const textResults = await fulltextSearch(query, col, filters, limit)
    const seenIds = new Set(results.map((r) => r.id))
    for (const tr of textResults) {
      if (!seenIds.has(tr.id)) {
        results.push(tr)
      }
    }
  }

  return results
}

export async function listEntries(
  filters?: KnowledgeListFilters,
  limit = 20,
  offset?: string,
  collection?: string
): Promise<{ entries: KnowledgeEntry[]; next_offset: string | null }> {
  const col = await ensureCollection(collection)
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
    `${cfg.qdrant_url}/collections/${col}/points/scroll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) throw new Error("Failed to list entries: " + await res.text())
  const data = await res.json()
  const entries = (data.result?.points || []).map(pointToEntry)
  return { entries, next_offset: data.result?.next_page_offset ?? null }
}

export async function listCollections(): Promise<string[]> {
  const cfg = loadConfig()
  const res = await fetch(`${cfg.qdrant_url}/collections`)
  if (!res.ok) return [cfg.default_collection]
  const data = await res.json()
  const names = (data.result?.collections || []).map((c: Record<string, unknown>) => c.name as string)
  return names.sort()
}
