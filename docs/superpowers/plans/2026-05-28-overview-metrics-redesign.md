# Overview Metrics Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os três boxes mortos do painel da Overview (`Taxa Sucesso`, `Erros`, `Latência Avg`) por `Sessões`, `Handoffs`, `Agentes ativos` e `Bloqueios`, derivados de dados que já existem em `metrics/*.jsonl` e `/api/status`, sem mexer na coleta backend.

**Architecture:** Apenas frontend Next.js do `dashboard/`. As rotas `/api/metrics` e `/api/metrics/history` passam a contar `sessions`, `handoffs`, `blocked` das mesmas linhas JSONL que já leem; o componente `MetricsPanel` é reescrito para consumir esses campos + receber a lista `agents` (já buscada por `page.tsx` via `/api/status`) para computar "Agentes ativos" point-in-time. Migração de tipos feita em duas fases para nunca deixar o build vermelho.

**Tech Stack:** Next.js 15 (App Router, route handlers), React 19, TypeScript 5.7. Sem framework de testes no projeto — verificação por `npm run build` (typecheck) + `curl` contra o dev server + smoke visual.

**Spec:** `docs/superpowers/specs/2026-05-28-overview-metrics-redesign-design.md`

---

## File Structure

Cinco arquivos tocados, todos em `dashboard/`. Nenhum arquivo criado.

| Arquivo | Responsabilidade após mudança |
|---|---|
| `app/lib/types.ts` | Define `DayMetrics` com `sessions`/`handoffs`/`blocked`. Campos antigos removidos. |
| `app/api/metrics/route.ts` | Conta o dia: `total_requests`, `sessions`, `handoffs`, `blocked`. `by_agent` permanece. |
| `app/api/metrics/history/route.ts` | Mesmas contagens por dia para sparklines de 7 dias. |
| `app/components/MetricsPanel.tsx` | Renderiza 5 boxes (Requests, Sessões, Handoffs, Agentes ativos, Bloqueios). Aceita prop `agents`. |
| `app/page.tsx` | Passa `agents={agents}` ao `<MetricsPanel>`. |

`AgentMetrics` (em `by_agent`) fica como está: ainda contém `success`/`errors`/`avg_latency_ms` por agente, mas nenhum componente lê — fora de escopo limpar.

---

## Verificação (sem framework de testes)

O dashboard não tem `vitest`/`jest`. Cada task termina com:

1. **Typecheck:** `cd dashboard && npm run build` → `✓ Compiled successfully`
2. **Endpoint check (quando uma rota foi tocada):** com `npm run dev` rodando em paralelo (`PORT 3040`), `curl -s http://localhost:3040/api/metrics | jq` confirma o shape.
3. **Smoke visual (quando UI foi tocada):** abrir `http://localhost:3040/` e conferir os boxes.

Se o dev server ainda não estiver rodando: `cd dashboard && npm run dev` em outro terminal antes da Task 1.

---

## Task 1: Estender contagens nas rotas e tipos (sem remover campos antigos)

Objetivo: adicionar `sessions`, `handoffs`, `blocked` em paralelo aos campos atuais. Build permanece verde porque o `MetricsPanel` continua usando os campos antigos.

**Files:**
- Modify: `dashboard/app/lib/types.ts:20-27`
- Modify: `dashboard/app/api/metrics/route.ts:22-69`
- Modify: `dashboard/app/api/metrics/history/route.ts:14-46`

### Steps

- [ ] **Step 1: Estender `DayMetrics` com os três campos novos**

Edite `dashboard/app/lib/types.ts`, substituindo a interface `DayMetrics`:

```ts
export interface DayMetrics {
  date?: string;
  total_requests: number;
  success: number;
  errors: number;
  avg_latency_ms: number;
  sessions: number;
  handoffs: number;
  blocked: number;
  by_agent: AgentMetrics[];
}
```

- [ ] **Step 2: Adicionar contagens em `/api/metrics`**

Edite `dashboard/app/api/metrics/route.ts`. No bloco que processa `lines` (logo após `const errors = lines.filter(...)`), insira:

```ts
const sessions = lines.filter((l) => l.action === "session").length;
const handoffs = lines.filter((l) =>
  l.action === "handoff_sent" ||
  l.action === "handoff_claimed" ||
  l.action === "handoff_processed"
).length;
const blocked = lines.filter((l) =>
  l.status === "blocked" || l.status === "budget_blocked"
).length;
```

Inclua os três no JSON de retorno do happy path:

```ts
return NextResponse.json({
  date: today,
  total_requests: lines.length,
  success,
  errors,
  avg_latency_ms: avgLatency,
  sessions,
  handoffs,
  blocked,
  by_agent: byAgent,
});
```

E no fallback de arquivo inexistente:

```ts
return NextResponse.json({
  date: today,
  total_requests: 0,
  success: 0,
  errors: 0,
  total_tokens_in: 0,
  total_tokens_out: 0,
  avg_latency_ms: 0,
  sessions: 0,
  handoffs: 0,
  blocked: 0,
  by_agent: [],
});
```

- [ ] **Step 3: Adicionar contagens em `/api/metrics/history`**

Edite `dashboard/app/api/metrics/history/route.ts`. Estenda o tipo do `result` e cada `push`:

```ts
const result: Array<{
  date: string;
  requests: number;
  success: number;
  errors: number;
  avg_latency_ms: number;
  sessions: number;
  handoffs: number;
  blocked: number;
}> = [];
```

Dentro do `try`, após calcular `avgLat`, adicione:

```ts
const sessions = lines.filter((l) => l.action === "session").length;
const handoffs = lines.filter((l) =>
  l.action === "handoff_sent" ||
  l.action === "handoff_claimed" ||
  l.action === "handoff_processed"
).length;
const blocked = lines.filter((l) =>
  l.status === "blocked" || l.status === "budget_blocked"
).length;

result.push({ date: dateStr, requests: lines.length, success, errors, avg_latency_ms: avgLat, sessions, handoffs, blocked });
```

E os dois `push` de erro/arquivo-ausente passam a:

```ts
result.push({ date: dateStr, requests: 0, success: 0, errors: 0, avg_latency_ms: 0, sessions: 0, handoffs: 0, blocked: 0 });
```

- [ ] **Step 4: Typecheck**

Run: `cd dashboard && npm run build`
Expected: `✓ Compiled successfully` sem erros TypeScript.

- [ ] **Step 5: Verificar payload de `/api/metrics`**

Com o dev server rodando em `http://localhost:3040`:

Run: `curl -s http://localhost:3040/api/metrics | jq '{date, total_requests, sessions, handoffs, blocked}'`

Expected: JSON com os 5 campos presentes. `sessions`/`handoffs`/`blocked` ≥ 0 e coerentes com:

`jq -r '.action' metrics/$(date -u +%F).jsonl | sort | uniq -c`

- [ ] **Step 6: Verificar payload de `/api/metrics/history`**

Run: `curl -s 'http://localhost:3040/api/metrics/history?days=7' | jq '.[0] | keys'`

Expected: a chave `sessions`, `handoffs` e `blocked` aparecem na lista.

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/lib/types.ts dashboard/app/api/metrics/route.ts dashboard/app/api/metrics/history/route.ts
git commit -m "feat(dashboard): adiciona contagens de sessions/handoffs/blocked nas rotas de métricas"
```

---

## Task 2: Reescrever `MetricsPanel` e propagar `agents` em `page.tsx`

Objetivo: o painel passa a renderizar os 5 boxes definidos no spec, consumindo os campos novos e a lista `agents` do `/api/status` (já presente no estado da página).

**Files:**
- Modify: `dashboard/app/components/MetricsPanel.tsx` (reescrever)
- Modify: `dashboard/app/page.tsx:100` (passar prop `agents`)

### Steps

- [ ] **Step 1: Reescrever `MetricsPanel.tsx`**

Substitua o conteúdo inteiro de `dashboard/app/components/MetricsPanel.tsx` por:

```tsx
"use client";
import { useEffect, useState } from "react";
import type { DayMetrics, AgentStatus } from "../lib/types";
import { Sparkline } from "./Sparkline";

interface HistoryEntry {
  date: string;
  requests: number;
  sessions: number;
  handoffs: number;
  blocked: number;
}

function MetricBox({ label, value, sublabel, color, sparkData, sparkColor }: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
  sparkData?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "12px 16px" }}>
      <div className="text-muted-xs mb-sm">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "var(--text-primary)" }}>
        {value}
      </div>
      {sparkData && sparkData.length > 1 ? (
        <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
          <Sparkline data={sparkData} width={100} height={24} color={sparkColor || color || "var(--accent)"} />
        </div>
      ) : sublabel ? (
        <div className="text-muted-xs" style={{ marginTop: 6 }}>{sublabel}</div>
      ) : null}
    </div>
  );
}

export function MetricsPanel({ metrics, agents }: { metrics: DayMetrics; agents: AgentStatus[] }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/metrics/history?days=7")
      .then((r) => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => {});
  }, []);

  const healthy = agents.filter((a) => a.state === "running" || a.state === "idle").length;
  const unhealthy = agents.filter((a) => a.state === "stale" || a.state === "error").length;

  return (
    <div>
      <h2 className="section-title">Visão geral</h2>
      <div className="grid grid-5">
        <MetricBox
          label="Requests"
          value={metrics.total_requests}
          sparkData={history.map((h) => h.requests)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Sessões"
          value={metrics.sessions}
          sparkData={history.map((h) => h.sessions)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Handoffs"
          value={metrics.handoffs}
          sparkData={history.map((h) => h.handoffs)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Agentes ativos"
          value={`${healthy} / ${agents.length}`}
          sublabel="agora"
          color={unhealthy > 0 ? "var(--warning)" : "var(--success)"}
        />
        <MetricBox
          label="Bloqueios"
          value={metrics.blocked}
          color={metrics.blocked > 0 ? "var(--error)" : "var(--success)"}
          sparkData={history.map((h) => h.blocked)}
          sparkColor="var(--error)"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Passar `agents` em `page.tsx`**

Edite `dashboard/app/page.tsx` linha 100, trocando:

```tsx
{metrics && <MetricsPanel metrics={metrics} />}
```

por:

```tsx
{metrics && <MetricsPanel metrics={metrics} agents={agents} />}
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard && npm run build`
Expected: `✓ Compiled successfully`. Se houver erro de "Property 'sessions' does not exist on type 'DayMetrics'", a Task 1 não foi aplicada — volte e refaça.

- [ ] **Step 4: Smoke visual**

Abra `http://localhost:3040/` no navegador.
Expected:
- Cabeçalho do painel diz "Visão geral".
- Cinco boxes lado a lado: Requests · Sessões · Handoffs · Agentes ativos · Bloqueios.
- "Agentes ativos" mostra `N / total` com sublabel "agora" e sem sparkline.
- "Bloqueios" fica verde se `0`, vermelho se `>0`.
- Demais boxes têm sparkline de 7 dias.

- [ ] **Step 5: Verificação cruzada das contagens**

Comparar `Sessões` exibido com:

`jq -c 'select(.action=="session")' metrics/$(date -u +%F).jsonl | wc -l`

Comparar `Handoffs` com:

`jq -c 'select(.action=="handoff_sent" or .action=="handoff_claimed" or .action=="handoff_processed")' metrics/$(date -u +%F).jsonl | wc -l`

Expected: bate exatamente.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/components/MetricsPanel.tsx dashboard/app/page.tsx
git commit -m "feat(dashboard): reformula painel da Overview com métricas honestas"
```

---

## Task 3: Remover campos legados do tipo e das rotas

Objetivo: limpar `success`, `errors`, `avg_latency_ms` que ninguém mais consome no nível de `DayMetrics`/history. `by_agent` fica como está (sem consumidor de UI, fora de escopo).

**Files:**
- Modify: `dashboard/app/lib/types.ts` (`DayMetrics`)
- Modify: `dashboard/app/api/metrics/route.ts` (resposta + fallback)
- Modify: `dashboard/app/api/metrics/history/route.ts` (tipo + pushes)

### Steps

- [ ] **Step 1: Confirmar que ninguém mais lê os campos legados**

Run:
```bash
cd dashboard && rg -n 'metrics\.success|metrics\.errors|metrics\.avg_latency_ms|\bsuccess:|\berrors:|\bavg_latency_ms:' app
```

Expected: as únicas ocorrências aparecem em `app/api/metrics/route.ts` e `app/api/metrics/history/route.ts` (que vamos editar agora). Nada em componentes. Se aparecer algo em um componente, **pare** — algo foi reintroduzido e este plano precisa de revisão.

- [ ] **Step 2: Enxugar `DayMetrics`**

Edite `dashboard/app/lib/types.ts` substituindo a interface:

```ts
export interface DayMetrics {
  date?: string;
  total_requests: number;
  sessions: number;
  handoffs: number;
  blocked: number;
  by_agent: AgentMetrics[];
}
```

- [ ] **Step 3: Enxugar `/api/metrics/route.ts`**

No `route.ts`, remova as linhas que computam `success`, `errors`, `avgLatency` (não são mais usadas no nível agregado — `by_agent` mantém suas próprias contagens). O retorno do happy path passa a:

```ts
return NextResponse.json({
  date: today,
  total_requests: lines.length,
  sessions,
  handoffs,
  blocked,
  by_agent: byAgent,
});
```

E o fallback de arquivo inexistente passa a:

```ts
return NextResponse.json({
  date: today,
  total_requests: 0,
  sessions: 0,
  handoffs: 0,
  blocked: 0,
  by_agent: [],
});
```

Observação: `byAgent` continua computando `success`/`errors`/`avg_latency_ms` por agente — não mexer.

- [ ] **Step 4: Enxugar `/api/metrics/history/route.ts`**

Substitua o tipo do `result`:

```ts
const result: Array<{
  date: string;
  requests: number;
  sessions: number;
  handoffs: number;
  blocked: number;
}> = [];
```

Dentro do `try`, remova `const success = ...`, `const errors = ...`, `const avgLat = ...` (não são mais usados). O `push` do happy path passa a:

```ts
result.push({ date: dateStr, requests: lines.length, sessions, handoffs, blocked });
```

Os dois `push` de erro/ausência passam a:

```ts
result.push({ date: dateStr, requests: 0, sessions: 0, handoffs: 0, blocked: 0 });
```

- [ ] **Step 5: Typecheck**

Run: `cd dashboard && npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Verificar payload final**

Run:
```bash
curl -s http://localhost:3040/api/metrics | jq 'keys'
curl -s 'http://localhost:3040/api/metrics/history?days=7' | jq '.[0] | keys'
```

Expected:
- `/api/metrics`: `["blocked","by_agent","date","handoffs","sessions","total_requests"]` (sem `success`, `errors`, `avg_latency_ms` no nível raiz).
- `/api/metrics/history`: `["blocked","date","handoffs","requests","sessions"]`.

- [ ] **Step 7: Smoke visual final**

Recarregar `http://localhost:3040/`. Os 5 boxes continuam renderizando exatamente como após a Task 2.

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/lib/types.ts dashboard/app/api/metrics/route.ts dashboard/app/api/metrics/history/route.ts
git commit -m "refactor(dashboard): remove campos legados de DayMetrics e rotas de métricas"
```

---

## Done

Critérios de sucesso do spec verificados:

- (1) Cinco boxes na primeira linha com valores coerentes — Task 2 Step 4 + Step 5.
- (2) Sparklines de 7d em Requests/Sessões/Handoffs/Bloqueios — Task 2 Step 4.
- (3) Troca de data recarrega os 4 do dia, mantém Agentes ativos — verificável manualmente no seletor de data.
- (4) Skeleton de loading continua com 5 placeholders alinhados — `page.tsx:91-94` já está em `grid-5`, não tocado.
- (5) `npm run build` sem erros de tipo — Task 1 Step 4, Task 2 Step 3, Task 3 Step 5.
