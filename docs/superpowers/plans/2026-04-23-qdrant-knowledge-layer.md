# Qdrant Knowledge Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared knowledge layer backed by Qdrant to the br-ai-on agent ecosystem, with a dashboard UI for browsing/editing and a shell script for agent publishing.

**Architecture:** TypeScript lib (`dashboard/lib/knowledge.ts`) encapsulates Qdrant REST API + Ollama embeddings. Next.js API routes expose CRUD + semantic search. Shell script (`lib/knowledge.sh`) acts as thin curl client for agents. Dashboard page provides search + CRUD UI.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Qdrant REST API, Ollama (nomic-embed-text, 768d), CSS Modules, Bash/curl.

**Spec:** `docs/superpowers/specs/2026-04-23-qdrant-knowledge-layer-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `config/knowledge.yaml` | Qdrant/Ollama/dashboard connection config |
| Create | `dashboard/lib/knowledge.ts` | Core lib: Qdrant client, embeddings, CRUD, search |
| Create | `dashboard/app/api/knowledge/entries/route.ts` | POST (create) + GET (list) entries |
| Create | `dashboard/app/api/knowledge/entries/[id]/route.ts` | GET/PUT/DELETE single entry |
| Create | `dashboard/app/api/knowledge/search/route.ts` | POST semantic search |
| Create | `dashboard/app/api/knowledge/meta/route.ts` | GET agents + domains lists |
| Create | `dashboard/app/knowledge/page.tsx` | Knowledge dashboard page |
| Create | `dashboard/app/knowledge/knowledge.module.css` | Page styles |
| Create | `lib/knowledge.sh` | Shell thin client for agents |
| Modify | `dashboard/app/components/icons.tsx` | Add IconKnowledge |
| Modify | `dashboard/app/components/Sidebar.tsx` | Add Knowledge nav link |
| Modify | `dashboard/app/lib/types.ts` | Add KnowledgeEntry types |

---

### Task 1: Configuration File

**Files:**
- Create: `config/knowledge.yaml`

- [ ] **Step 1: Create config file**

```yaml
qdrant_url: http://localhost:6333
ollama_url: http://localhost:11434
embedding_model: nomic-embed-text
embedding_dimensions: 768
collection_name: braion_knowledge
dashboard_url: http://localhost:3040
```

- [ ] **Step 2: Commit**

```bash
git add config/knowledge.yaml
git commit -m "feat(knowledge): add Qdrant knowledge layer config"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `dashboard/app/lib/types.ts`

- [ ] **Step 1: Add knowledge types to the end of types.ts**

Append after the existing `EpisodicEntry` interface:

```typescript
export type KnowledgeType = 'insight' | 'decision' | 'fact' | 'procedure'
export type KnowledgeSource = 'agent-session' | 'manual' | 'handoff'

export interface KnowledgeEntry {
  id: string
  text: string
  agent: string
  domain: string[]
  type: KnowledgeType
  source: KnowledgeSource
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

export interface KnowledgeSearchResult extends KnowledgeEntry {
  score: number
}

export interface KnowledgeSearchFilters {
  agent?: string
  domain?: string
  type?: KnowledgeType
}

export interface KnowledgeListFilters extends KnowledgeSearchFilters {
  limit?: number
  offset?: string
}

export interface CreateKnowledgeInput {
  text: string
  agent: string
  domain: string[]
  type: KnowledgeType
  source: KnowledgeSource
  metadata?: Record<string, unknown>
}

export interface UpdateKnowledgeInput {
  text?: string
  agent?: string
  domain?: string[]
  type?: KnowledgeType
  metadata?: Record<string, unknown>
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/lib/types.ts
git commit -m "feat(knowledge): add KnowledgeEntry types"
```

---

### Task 3: Core Library — `knowledge.ts`

**Files:**
- Create: `dashboard/lib/knowledge.ts`

This is the main lib. It talks directly to Qdrant REST API and Ollama. No npm dependencies needed — uses native `fetch()`.

- [ ] **Step 1: Create the knowledge lib**

Create `dashboard/lib/knowledge.ts`:

```typescript
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /home/mcpgw/pessoal/projects/br-ai-on/dashboard && npx tsc --noEmit lib/knowledge.ts 2>&1 | head -20`

If there are import path issues, fix them. The `@/` alias maps to the dashboard root.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/knowledge.ts
git commit -m "feat(knowledge): add core Qdrant + Ollama knowledge lib"
```

---

### Task 4: API Route — Entries Collection (POST + GET)

**Files:**
- Create: `dashboard/app/api/knowledge/entries/route.ts`

- [ ] **Step 1: Create the entries route**

Create `dashboard/app/api/knowledge/entries/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createEntry, listEntries } from "@/lib/knowledge"
import type { CreateKnowledgeInput } from "@/app/lib/types"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["insight", "decision", "fact", "procedure"]
const VALID_SOURCES = ["agent-session", "manual", "handoff"]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateKnowledgeInput
    if (!body.text || !body.agent || !body.type) {
      return NextResponse.json(
        { error: "text, agent, and type are required" },
        { status: 400 }
      )
    }
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }
    if (body.source && !VALID_SOURCES.includes(body.source)) {
      return NextResponse.json(
        { error: `source must be one of: ${VALID_SOURCES.join(", ")}` },
        { status: 400 }
      )
    }
    const input: CreateKnowledgeInput = {
      text: body.text,
      agent: body.agent,
      domain: body.domain || [],
      type: body.type,
      source: body.source || "manual",
      metadata: body.metadata || {},
    }
    const id = await createEntry(input)
    return NextResponse.json({ ok: true, id }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create entry: " + String(err) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const filters = {
      agent: params.get("agent") || undefined,
      domain: params.get("domain") || undefined,
      type: params.get("type") as CreateKnowledgeInput["type"] | undefined,
    }
    const limit = parseInt(params.get("limit") || "20", 10)
    const offset = params.get("offset") || undefined

    const result = await listEntries(filters, limit, offset)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list entries: " + String(err) },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify with curl (requires Qdrant + Ollama running)**

```bash
curl -s -X POST http://localhost:3040/api/knowledge/entries \
  -H "Content-Type: application/json" \
  -d '{"text":"Test entry","agent":"test","type":"fact","domain":["test"],"source":"manual"}' | jq .
```

Expected: `{ "ok": true, "id": "<uuid>" }`

```bash
curl -s http://localhost:3040/api/knowledge/entries | jq .
```

Expected: `{ "entries": [...], "next_offset": null }`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/knowledge/entries/route.ts
git commit -m "feat(knowledge): add entries API route (POST + GET)"
```

---

### Task 5: API Route — Single Entry (GET/PUT/DELETE)

**Files:**
- Create: `dashboard/app/api/knowledge/entries/[id]/route.ts`

- [ ] **Step 1: Create the single entry route**

Create `dashboard/app/api/knowledge/entries/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getEntry, updateEntry, deleteEntry } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["insight", "decision", "fact", "procedure"]

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const entry = await getEntry(id)
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    return NextResponse.json(entry)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to get entry: " + String(err) },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    if (body.type && !VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }
    await updateEntry(id, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = String(err)
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    return NextResponse.json(
      { error: "Failed to update entry: " + msg },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteEntry(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete entry: " + String(err) },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify with curl**

```bash
# Use the ID from the POST in Task 4
ID="<paste-id-here>"
curl -s http://localhost:3040/api/knowledge/entries/$ID | jq .
curl -s -X PUT http://localhost:3040/api/knowledge/entries/$ID \
  -H "Content-Type: application/json" \
  -d '{"text":"Updated test entry"}' | jq .
curl -s -X DELETE http://localhost:3040/api/knowledge/entries/$ID | jq .
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/knowledge/entries/\[id\]/route.ts
git commit -m "feat(knowledge): add single entry API route (GET/PUT/DELETE)"
```

---

### Task 6: API Route — Semantic Search

**Files:**
- Create: `dashboard/app/api/knowledge/search/route.ts`

- [ ] **Step 1: Create the search route**

Create `dashboard/app/api/knowledge/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { searchEntries } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.query) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      )
    }
    const filters = {
      agent: body.agent || undefined,
      domain: body.domain || undefined,
      type: body.type || undefined,
    }
    const limit = body.limit || 10
    const results = await searchEntries(body.query, filters, limit)
    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json(
      { error: "Search failed: " + String(err) },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s -X POST http://localhost:3040/api/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test entry"}' | jq .
```

Expected: `{ "results": [ { "id": "...", "text": "...", "score": 0.95, ... } ] }`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/knowledge/search/route.ts
git commit -m "feat(knowledge): add semantic search API route"
```

---

### Task 7: API Route — Meta (Agents + Domains)

**Files:**
- Create: `dashboard/app/api/knowledge/meta/route.ts`

This route reads agent config.yaml files to extract available agents and domains, same pattern used by `/api/agents/route.ts`.

- [ ] **Step 1: Create the meta route**

Create `dashboard/app/api/knowledge/meta/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { readdirSync, readFileSync, existsSync, lstatSync } from "fs"
import { join } from "path"
import { parse } from "yaml"

export const dynamic = "force-dynamic"

const PROJECT_ROOT = process.env.BRAION_ROOT || join(process.cwd(), "..")
const AGENTS_DIR = join(PROJECT_ROOT, "agents")
const USER_AGENTS = process.env.BRAION_AGENTS_DIR || join(
  process.env.HOME || "/home/mcpgw",
  ".config", "br-ai-on", "agents"
)

function collectAgentMeta(): { agents: string[]; domains: string[] } {
  const agentSet = new Set<string>()
  const domainSet = new Set<string>()

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
      } catch {
        agentSet.add(entry)
      }
    }
  }

  return {
    agents: [...agentSet].sort(),
    domains: [...domainSet].sort(),
  }
}

export async function GET() {
  try {
    const meta = collectAgentMeta()
    return NextResponse.json(meta)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to collect meta: " + String(err) },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s http://localhost:3040/api/knowledge/meta | jq .
```

Expected: `{ "agents": ["braion", "finance-ops", ...], "domains": ["netsuite", "billing", ...] }`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/knowledge/meta/route.ts
git commit -m "feat(knowledge): add meta API route (agents + domains)"
```

---

### Task 8: Dashboard UI — Icon + Sidebar

**Files:**
- Modify: `dashboard/app/components/icons.tsx`
- Modify: `dashboard/app/components/Sidebar.tsx`

- [ ] **Step 1: Add IconKnowledge to icons.tsx**

Add before the closing of the file (after `IconChevronRight`):

```typescript
export function IconKnowledge() {
  return (
    <svg {...s} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="12" y1="8" x2="12" y2="16" />
    </svg>
  );
}
```

Note: this is a simple "plus in circle" icon representing knowledge base. If preferred, a book/brain icon can be used instead.

- [ ] **Step 2: Add Knowledge to Sidebar NAV**

In `Sidebar.tsx`, add the import for `IconKnowledge`:

Change the import line from:
```typescript
import { IconDashboard, IconLogs, IconHandoffs, IconAgents, IconMemories, IconTerminal, IconWizard, IconIntegrations, IconCron, IconMenu, IconClose, IconGithub, IconChevronLeft, IconChevronRight } from "./icons";
```
to:
```typescript
import { IconDashboard, IconLogs, IconHandoffs, IconAgents, IconMemories, IconTerminal, IconWizard, IconIntegrations, IconCron, IconMenu, IconClose, IconGithub, IconChevronLeft, IconChevronRight, IconKnowledge } from "./icons";
```

Then add a new entry to the `NAV` array, after the `integrations` entry:

```typescript
{ href: "/knowledge", label: "Knowledge", icon: IconKnowledge },
```

So the NAV array becomes:
```typescript
const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: IconDashboard },
  {
    href: "/logs", label: "Logs", icon: IconLogs,
    children: [
      { href: "/logs", label: "Agentes", icon: IconLogs },
      { href: "/logs/cron", label: "Cron", icon: IconCron },
    ],
  },
  { href: "/handoffs", label: "Handoffs", icon: IconHandoffs },
  { href: "/agents", label: "Agents", icon: IconAgents },
  { href: "/wizard", label: "Wizard", icon: IconWizard },
  { href: "/terminal", label: "Terminais", icon: IconTerminal },
  { href: "/integrations", label: "Integrações", icon: IconIntegrations },
  { href: "/knowledge", label: "Knowledge", icon: IconKnowledge },
];
```

- [ ] **Step 3: Verify sidebar renders**

Run the dashboard dev server and check that the Knowledge link appears in the sidebar. Clicking it should show a 404 (page not created yet).

```bash
cd /home/mcpgw/pessoal/projects/br-ai-on/dashboard && npm run dev
```

Open `http://localhost:3041` (homolog) and check sidebar.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/components/icons.tsx dashboard/app/components/Sidebar.tsx
git commit -m "feat(knowledge): add Knowledge icon and sidebar link"
```

---

### Task 9: Dashboard UI — Knowledge Page + CSS

**Files:**
- Create: `dashboard/app/knowledge/page.tsx`
- Create: `dashboard/app/knowledge/knowledge.module.css`

- [ ] **Step 1: Create CSS module**

Create `dashboard/app/knowledge/knowledge.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.searchInput {
  flex: 1;
  min-width: 200px;
  font-size: 13px;
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.searchInput::placeholder {
  color: var(--text-muted);
}

.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filterSelect {
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
}

.entryCard {
  margin-bottom: 8px;
}

.entryHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.entryText {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.entryFooter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.entryDate {
  font-size: 11px;
  color: var(--text-muted);
}

.entryActions {
  display: flex;
  gap: 6px;
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modalContent {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
}

.formGroup {
  margin-bottom: 12px;
}

.formLabel {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.scoreBar {
  display: inline-block;
  font-size: 11px;
  color: var(--accent);
  margin-left: auto;
}

.loadMore {
  display: block;
  width: 100%;
  text-align: center;
  padding: 12px;
  margin-top: 8px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 0;
  font-size: 13px;
}
```

- [ ] **Step 2: Create the Knowledge page**

Create `dashboard/app/knowledge/page.tsx`:

```typescript
"use client"
import { useEffect, useState, useCallback } from "react"
import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  KnowledgeType,
  KnowledgeSource,
  CreateKnowledgeInput,
} from "../lib/types"
import styles from "./knowledge.module.css"

const TYPE_COLORS: Record<KnowledgeType, string> = {
  insight: "badge-info",
  decision: "badge-warning",
  fact: "badge-success",
  procedure: "badge-muted",
}

interface EntryFormData {
  text: string
  agent: string
  domain: string
  type: KnowledgeType
  source: KnowledgeSource
}

const EMPTY_FORM: EntryFormData = {
  text: "",
  agent: "",
  domain: "",
  type: "fact",
  source: "manual",
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<(KnowledgeEntry | KnowledgeSearchResult)[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [nextOffset, setNextOffset] = useState<string | null>(null)

  const [agentFilter, setAgentFilter] = useState("")
  const [domainFilter, setDomainFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")

  const [agents, setAgents] = useState<string[]>([])
  const [domains, setDomains] = useState<string[]>([])

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EntryFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/knowledge/meta")
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.agents || [])
        setDomains(data.domains || [])
      })
      .catch(() => {})
  }, [])

  const fetchEntries = useCallback(
    (append = false) => {
      if (!append) setLoading(true)
      const params = new URLSearchParams()
      if (agentFilter) params.set("agent", agentFilter)
      if (domainFilter) params.set("domain", domainFilter)
      if (typeFilter) params.set("type", typeFilter)
      params.set("limit", "20")
      if (append && nextOffset) params.set("offset", nextOffset)

      fetch(`/api/knowledge/entries?${params}`)
        .then((r) => r.json())
        .then((data) => {
          const list = data.entries || []
          setEntries((prev) => (append ? [...prev, ...list] : list))
          setNextOffset(data.next_offset)
          setIsSearchMode(false)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    },
    [agentFilter, domainFilter, typeFilter, nextOffset]
  )

  useEffect(() => {
    fetchEntries()
  }, [agentFilter, domainFilter, typeFilter])

  const doSearch = () => {
    if (!searchQuery.trim()) {
      fetchEntries()
      return
    }
    setLoading(true)
    fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        agent: agentFilter || undefined,
        domain: domainFilter || undefined,
        type: typeFilter || undefined,
        limit: 20,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.results || [])
        setIsSearchMode(true)
        setNextOffset(null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doSearch()
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError("")
    setShowModal(true)
  }

  const openEdit = (entry: KnowledgeEntry) => {
    setForm({
      text: entry.text,
      agent: entry.agent,
      domain: entry.domain.join(", "),
      type: entry.type,
      source: entry.source,
    })
    setEditingId(entry.id)
    setError("")
    setShowModal(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError("")
    try {
      const domainArr = form.domain
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)

      if (editingId) {
        const res = await fetch(`/api/knowledge/entries/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: form.text,
            agent: form.agent,
            domain: domainArr,
            type: form.type,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Erro ao atualizar")
        }
      } else {
        const input: CreateKnowledgeInput = {
          text: form.text,
          agent: form.agent,
          domain: domainArr,
          type: form.type,
          source: form.source,
        }
        const res = await fetch("/api/knowledge/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Erro ao criar")
        }
      }
      setShowModal(false)
      fetchEntries()
    } catch (err) {
      setError(String(err))
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Deletar este entry?")) return
    await fetch(`/api/knowledge/entries/${id}`, { method: "DELETE" })
    fetchEntries()
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return iso
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className="page-header">
        <h1 className="page-title">Knowledge Base</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          + Novo Entry
        </button>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Busca semantica..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary" onClick={doSearch}>
          Buscar
        </button>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.filterSelect}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">Todos agentes</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="">Todos dominios</option>
          {domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Todos tipos</option>
          <option value="insight">Insight</option>
          <option value="decision">Decision</option>
          <option value="fact">Fact</option>
          <option value="procedure">Procedure</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.empty}>Carregando...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>Nenhum entry encontrado</div>
      ) : (
        <>
          {entries.map((entry) => (
            <div key={entry.id} className={`card ${styles.entryCard}`}>
              <div className={styles.entryHeader}>
                <span className={`badge ${TYPE_COLORS[entry.type]}`}>
                  {entry.type}
                </span>
                <span className="badge badge-muted">{entry.agent}</span>
                {entry.domain.map((d) => (
                  <span key={d} className="badge badge-muted" style={{ fontSize: 10 }}>
                    {d}
                  </span>
                ))}
                {"score" in entry && (
                  <span className={styles.scoreBar}>
                    {(entry.score as number).toFixed(3)}
                  </span>
                )}
              </div>
              <div className={styles.entryText}>{entry.text}</div>
              <div className={styles.entryFooter}>
                <span className={styles.entryDate}>
                  {formatDate(entry.created_at)}
                  {entry.source !== "manual" && ` · ${entry.source}`}
                </span>
                <div className={styles.entryActions}>
                  <button
                    className="btn btn-sm"
                    onClick={() => openEdit(entry)}
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(entry.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!isSearchMode && nextOffset && (
            <button
              className={`btn ${styles.loadMore}`}
              onClick={() => fetchEntries(true)}
            >
              Carregar mais
            </button>
          )}
        </>
      )}

      {showModal && (
        <div className={styles.modal} onClick={() => setShowModal(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 16, fontSize: 16 }}>
              {editingId ? "Editar Entry" : "Novo Entry"}
            </h2>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Texto</label>
              <textarea
                className="textarea"
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={4}
                style={{ minHeight: 100 }}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Agente</label>
              <select
                className="select"
                value={form.agent}
                onChange={(e) => setForm({ ...form, agent: e.target.value })}
              >
                <option value="">Selecionar...</option>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Dominios (separados por virgula)
              </label>
              <input
                className="input"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="netsuite, billing"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Tipo</label>
              <select
                className="select"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as KnowledgeType })
                }
              >
                <option value="insight">Insight</option>
                <option value="decision">Decision</option>
                <option value="fact">Fact</option>
                <option value="procedure">Procedure</option>
              </select>
            </div>
            {!editingId && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Source</label>
                <select
                  className="select"
                  value={form.source}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      source: e.target.value as KnowledgeSource,
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="agent-session">Agent Session</option>
                  <option value="handoff">Handoff</option>
                </select>
              </div>
            )}
            {error && (
              <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.text || !form.agent}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders**

Open `http://localhost:3041/knowledge` in the browser. Should show the empty state "Nenhum entry encontrado" with the search bar, filters, and "Novo Entry" button.

- [ ] **Step 4: End-to-end test**

1. Click "+ Novo Entry", fill the form, save. Verify card appears.
2. Type a query in the search bar, click "Buscar". Verify results show with score.
3. Click "Editar" on a card, change text, save. Verify update.
4. Click "×" on a card, confirm deletion. Verify card disappears.
5. Use the filter dropdowns to filter by agent and domain.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/knowledge/
git commit -m "feat(knowledge): add Knowledge Base dashboard page"
```

---

### Task 10: Shell Script — `knowledge.sh`

**Files:**
- Create: `lib/knowledge.sh`

Follows the same pattern as `lib/telegram.sh`: sourceable + direct execution mode.

- [ ] **Step 1: Create the shell script**

Create `lib/knowledge.sh`:

```bash
#!/usr/bin/env bash
# lib/knowledge.sh — Thin client para Knowledge Base API
#
# Uso como biblioteca (source):
#   source "$(dirname "$0")/../lib/knowledge.sh"
#   knowledge_publish "agent-name" "insight" "texto do knowledge" --domain "netsuite,billing"
#   knowledge_search "query" --agent "agent-name" --domain "netsuite"
#
# Uso direto:
#   bash lib/knowledge.sh publish <agent> <type> "texto" [--domain d1,d2]
#   bash lib/knowledge.sh search "query" [--agent X] [--domain X] [--type X] [--limit N]
#   bash lib/knowledge.sh list [--agent X] [--domain X] [--type X] [--limit N]

_KB_BRAION="${_KB_BRAION:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"

_kb_dashboard_url() {
  local config_file="$_KB_BRAION/config/knowledge.yaml"
  if [ -f "$config_file" ]; then
    local url
    url=$(grep '^dashboard_url:' "$config_file" | sed 's/^dashboard_url: *//' | tr -d '"' | tr -d "'")
    [ -n "$url" ] && echo "$url" && return
  fi
  echo "http://localhost:3040"
}

_kb_agent_domains() {
  local agent="$1"
  local config_file="$_KB_BRAION/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && config_file="$HOME/.config/br-ai-on/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && echo "[]" && return
  local domains
  domains=$(python3 -c "
import yaml, json, sys
try:
    with open('$config_file') as f:
        cfg = yaml.safe_load(f)
    print(json.dumps(cfg.get('domain', [])))
except:
    print('[]')
" 2>/dev/null)
  echo "${domains:-[]}"
}

knowledge_publish() {
  local agent="$1" type="$2" text="$3"
  shift 3 2>/dev/null || { echo "ERROR: uso: knowledge_publish <agent> <type> <text> [--domain d1,d2]" >&2; return 1; }

  local domain_csv=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain_csv="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local domains
  if [ -n "$domain_csv" ]; then
    domains=$(echo "$domain_csv" | python3 -c "import json,sys; print(json.dumps([d.strip() for d in sys.stdin.read().split(',') if d.strip()]))")
  else
    domains=$(_kb_agent_domains "$agent")
  fi

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({
    'text': '''$text''',
    'agent': '$agent',
    'domain': json.loads('$domains'),
    'type': '$type',
    'source': 'agent-session'
}))
")

  local response
  response=$(curl -s -X POST "$base_url/api/knowledge/entries" \
    -H "Content-Type: application/json" \
    -d "$payload")

  echo "$response"
}

knowledge_search() {
  local query="$1"
  shift 2>/dev/null || { echo "ERROR: uso: knowledge_search <query> [--agent X] [--domain X] [--type X] [--limit N]" >&2; return 1; }

  local agent="" domain="" type="" limit="10"
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(python3 -c "
import json
d = {'query': '''$query''', 'limit': $limit}
if '$agent': d['agent'] = '$agent'
if '$domain': d['domain'] = '$domain'
if '$type': d['type'] = '$type'
print(json.dumps(d))
")

  curl -s -X POST "$base_url/api/knowledge/search" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

knowledge_list() {
  local agent="" domain="" type="" limit="20"
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)
  local params="limit=$limit"
  [ -n "$agent" ] && params="$params&agent=$agent"
  [ -n "$domain" ] && params="$params&domain=$domain"
  [ -n "$type" ] && params="$params&type=$type"

  curl -s "$base_url/api/knowledge/entries?$params"
}

# ── Modo direto ──────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail

  _kb_usage() {
    cat <<'EOF'
lib/knowledge.sh — Cliente da Knowledge Base API

Uso:
  bash lib/knowledge.sh publish <agent> <type> "texto" [--domain d1,d2]
  bash lib/knowledge.sh search "query" [--agent X] [--domain X] [--type X] [--limit N]
  bash lib/knowledge.sh list [--agent X] [--domain X] [--type X] [--limit N]

Tipos: insight, decision, fact, procedure
EOF
    exit "${1:-0}"
  }

  cmd="${1:-}"
  shift 2>/dev/null || true

  case "$cmd" in
    publish)
      agent="${1:-}"; shift 2>/dev/null || true
      type="${1:-}"; shift 2>/dev/null || true
      text="${1:-}"; shift 2>/dev/null || true
      [ -z "$agent" ] || [ -z "$type" ] || [ -z "$text" ] && {
        echo "ERROR: publish requer <agent> <type> <texto>" >&2; _kb_usage 1;
      }
      knowledge_publish "$agent" "$type" "$text" "$@"
      ;;
    search)
      query="${1:-}"; shift 2>/dev/null || true
      [ -z "$query" ] && { echo "ERROR: search requer <query>" >&2; _kb_usage 1; }
      knowledge_search "$query" "$@"
      ;;
    list)
      knowledge_list "$@"
      ;;
    help|--help|-h)
      _kb_usage 0
      ;;
    *)
      echo "ERROR: comando desconhecido '$cmd'" >&2
      _kb_usage 1
      ;;
  esac
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x lib/knowledge.sh
```

- [ ] **Step 3: Verify direct execution (requires dashboard running)**

```bash
cd /home/mcpgw/pessoal/projects/br-ai-on

# Publish
bash lib/knowledge.sh publish "test-agent" "fact" "O endpoint /api/v1/items retorna max 500 registros por pagina" --domain "api,test"

# Search
bash lib/knowledge.sh search "endpoint items" | python3 -m json.tool

# List
bash lib/knowledge.sh list --limit 5 | python3 -m json.tool
```

- [ ] **Step 4: Verify sourceable mode**

```bash
source lib/knowledge.sh
knowledge_search "endpoint" --limit 3 | python3 -m json.tool
```

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge.sh
git commit -m "feat(knowledge): add shell thin client for agents"
```

---

### Task 11: Final Integration Verification

- [ ] **Step 1: End-to-end flow — agent publishes, dashboard shows**

```bash
# Agent publishes via shell
bash lib/knowledge.sh publish "finance-ops" "insight" "VendorBill com subsidiary 3 requer approval diferente" --domain "netsuite,billing"
```

Then open `http://localhost:3041/knowledge` and verify the entry appears. Search for "subsidiary 3" and verify semantic search finds it.

- [ ] **Step 2: Verify cross-agent search**

```bash
bash lib/knowledge.sh publish "netsuite-monitor" "fact" "Endpoint getVendorBill retorna max 1000 registros" --domain "netsuite"
bash lib/knowledge.sh search "vendor bill limit"
```

Should return both entries (finance-ops and netsuite-monitor) since no agent filter was specified.

- [ ] **Step 3: Verify filters work in dashboard**

In the dashboard, select "finance-ops" from the agent dropdown. Only the finance-ops entry should show. Clear the filter and select "netsuite" from domains. Both entries should show.

- [ ] **Step 4: Commit all if any uncommitted changes remain**

```bash
git status
# If clean, skip. Otherwise:
git add -A && git commit -m "feat(knowledge): final integration adjustments"
```
