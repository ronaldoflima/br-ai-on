# Qdrant Knowledge Layer — Design Spec

**Data:** 2026-04-23
**Branch:** feat/qdrant-knowledge-layer
**Status:** Aprovado

---

## Objetivo

Adicionar uma camada de knowledge compartilhado entre agentes usando Qdrant como vector database. Os agentes publicam insights, decisões, fatos e procedimentos que ficam disponíveis para busca semântica cross-agent. A memória local existente (semantic.md + episodic.jsonl) permanece intacta.

---

## Decisões de Design

| Decisao | Escolha | Motivo |
|---------|---------|--------|
| Relação com memória local | Camada nova (complementar) | Não quebra o que funciona, adiciona busca semântica cross-agent |
| Instância Qdrant | Apontar para existente (configurável) | Flexível, docker-compose como melhoria futura |
| Arquitetura | API routes no dashboard + lib TS + shell thin client | Centraliza lógica de embeddings, zero processo novo |
| Dashboard | Read + Write | Buscar, criar, editar, deletar entries manualmente |
| Embeddings | Ollama + nomic-embed-text (768d) | Já em uso no personal-gateway, roda local |

---

## Configuração

Arquivo `config/knowledge.yaml` na raiz do projeto:

```yaml
qdrant_url: http://localhost:6333
ollama_url: http://localhost:11434
embedding_model: nomic-embed-text
embedding_dimensions: 768
collection_name: braion_knowledge
dashboard_url: http://localhost:3040
```

Lido pelo dashboard (TypeScript) para qdrant/ollama, e pelo `knowledge.sh` para `dashboard_url` (endpoint das API routes). Um unico ponto de configuracao.

---

## Schema do Knowledge Entry

Collection: `braion_knowledge` — vectors 768d, cosine similarity.

Payload de cada point:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `text` | string | Conteudo do knowledge em texto livre |
| `agent` | string | Nome do agente que publicou (ex: `finance-ops`) |
| `domain` | string[] | Dominios do agente, extraidos do config.yaml (ex: `["netsuite", "billing"]`) |
| `type` | string | Enum: `insight`, `decision`, `fact`, `procedure` |
| `source` | string | Enum: `agent-session`, `manual`, `handoff` |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |
| `metadata` | object | Campo livre para dados extras |

Filtros indexados: `agent` (keyword), `domain` (keyword), `type` (keyword), `source` (keyword).

Todos os filtros sao opcionais na busca. Sem filtro = busca cross-agent em tudo.

---

## Lib TypeScript — `dashboard/lib/knowledge.ts`

Camada core que encapsula Qdrant + Ollama:

```typescript
// Configuracao
loadKnowledgeConfig(): KnowledgeConfig

// Collection management
ensureCollection(): Promise<void>
// Cria collection se nao existir (HNSW, cosine, 768d)
// Cria payload indexes para agent, domain, type, source

// Embeddings
generateEmbedding(text: string): Promise<number[]>
// POST ollama_url/api/embed { model, input: text }

// CRUD
createEntry(entry: CreateEntryInput): Promise<string>
// Gera embedding, upsert no Qdrant, retorna ID (uuid)

getEntry(id: string): Promise<KnowledgeEntry | null>
// Retrieve por ID

updateEntry(id: string, data: UpdateEntryInput): Promise<void>
// Re-gera embedding se text mudou, upsert

deleteEntry(id: string): Promise<void>
// Delete por ID

// Search
searchEntries(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResult[]>
// Gera embedding da query, busca com filtros opcionais
// Retorna entries ordenados por score

listEntries(filters?: ListFilters, limit?: number, offset?: string): Promise<ListResult>
// Scroll sem embedding, para listagem paginada no dashboard
// Filtra por agent, domain, type
```

### Tipos

```typescript
interface KnowledgeEntry {
  id: string
  text: string
  agent: string
  domain: string[]
  type: 'insight' | 'decision' | 'fact' | 'procedure'
  source: 'agent-session' | 'manual' | 'handoff'
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

interface SearchFilters {
  agent?: string
  domain?: string
  type?: string
}

interface SearchResult extends KnowledgeEntry {
  score: number
}
```

---

## API Routes — `dashboard/app/api/knowledge/`

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/knowledge/entries` | Criar entry |
| GET | `/api/knowledge/entries` | Listar com filtros + paginacao (`?agent=X&domain=Y&type=Z&limit=20&offset=token`) |
| GET | `/api/knowledge/entries/[id]` | Detalhe de um entry |
| PUT | `/api/knowledge/entries/[id]` | Atualizar entry |
| DELETE | `/api/knowledge/entries/[id]` | Deletar entry |
| POST | `/api/knowledge/search` | Busca semantica (`{ query, agent?, domain?, type?, limit? }`) |
| GET | `/api/knowledge/domains` | Lista dominios disponiveis (extraidos dos config.yaml dos agentes) |
| GET | `/api/knowledge/agents` | Lista agentes disponiveis |

Todas as rotas retornam JSON. Erros seguem o padrao `{ error: string }` com HTTP status codes adequados.

A rota POST `/api/knowledge/entries` e a rota de search chamam `ensureCollection()` na primeira execucao (lazy init).

---

## Shell Script — `lib/knowledge.sh`

Thin client que faz `curl` nas API routes do dashboard. Mesmo padrao de `lib/telegram.sh`.

Le `config/knowledge.yaml` para obter a URL base do dashboard (default: `http://localhost:3040`).

### Funcoes

```bash
# Publicar knowledge
knowledge_publish <agent> <type> <text> [--domain <domain1,domain2>]
# POST /api/knowledge/entries
# domain: se nao informado, extrai do config.yaml do agente

# Buscar knowledge
knowledge_search <query> [--agent <agent>] [--domain <domain>] [--type <type>] [--limit <n>]
# POST /api/knowledge/search
# Retorna JSON com resultados

# Listar entries
knowledge_list [--agent <agent>] [--domain <domain>] [--type <type>] [--limit <n>]
# GET /api/knowledge/entries com query params
```

### Exemplo de uso por um agente

```bash
source "$PROJECT_ROOT/lib/knowledge.sh"

# Agente descobriu algo durante execucao
knowledge_publish "finance-ops" "insight" "VendorBill com subsidiary 3 precisa de approval workflow diferente" --domain "netsuite,billing"

# Agente busca contexto antes de agir
results=$(knowledge_search "approval workflow netsuite" --domain "netsuite")
```

---

## Dashboard UI — `dashboard/app/knowledge/page.tsx`

### Layout

```
+------------------------------------------------------------------+
|  Knowledge Base                                    [+ Novo Entry] |
+------------------------------------------------------------------+
|  [====== Busca semantica ======]  [Buscar]                       |
|                                                                   |
|  Filtros: [Agente v] [Dominio v] [Tipo v]                       |
+------------------------------------------------------------------+
|                                                                   |
|  +-card----------------------------------------------------+     |
|  | insight | finance-ops | netsuite, billing                |     |
|  | VendorBill com subsidiary 3 precisa de approval...       |     |
|  | 2026-04-23 14:00                           [Editar] [x]  |     |
|  +----------------------------------------------------------+     |
|                                                                   |
|  +-card----------------------------------------------------+     |
|  | fact | netsuite-monitor | netsuite                       |     |
|  | Endpoint getVendorBill retorna max 1000 registros...     |     |
|  | 2026-04-22 09:30                           [Editar] [x]  |     |
|  +----------------------------------------------------------+     |
|                                                                   |
|  [Carregar mais...]                                               |
+------------------------------------------------------------------+
```

### Componentes

- **Barra de busca**: input + botao, faz POST `/api/knowledge/search`
- **Filtros**: dropdowns populados via GET `/api/knowledge/agents` e `/api/knowledge/domains`. Multi-select para agente e dominio.
- **Lista de cards**: cada card mostra type (badge colorido), agent, domains, preview do texto (truncado), data, botoes editar/deletar
- **Modal de criacao/edicao**: form com campos text (textarea), agent (select), domain (multi-select), type (select), metadata (JSON editor simples)
- **Paginacao**: botao "carregar mais" com scroll offset

### Navegacao

Adicionar link "Knowledge" no sidebar/nav do dashboard existente.

---

## Requisitos para Rodar

1. **Qdrant** acessivel na URL configurada em `config/knowledge.yaml`
2. **Ollama** com modelo `nomic-embed-text` instalado (`ollama pull nomic-embed-text`)
3. **Dashboard** rodando (ja e requisito existente do projeto)

O `ensureCollection()` cria a collection automaticamente no primeiro uso. Zero setup manual no Qdrant.

---

## Fora de Escopo (futuro)

- Docker-compose para Qdrant standalone
- Analytics (metricas por agente, dominios mais ativos, evolucao temporal)
- Integracao automatica no agent-init (carregar knowledge relevante no prompt)
- Sync bidirecional com semantic.md
- Bulk import de entries existentes
