# Reformulação do painel de métricas da Overview

**Data:** 2026-05-28
**Escopo:** dashboard (frontend + rotas Next.js). Backend (`lib/metrics.sh`, JSONL) intocado.

## Problema

A tela `dashboard/app/page.tsx` exibe um `MetricsPanel` com cinco posições no `grid-5`,
preenchidas por quatro boxes: **Requests**, **Taxa Sucesso**, **Erros**, **Latência Avg**.
Dos quatro, apenas **Requests** transmite informação real. Análise de 1.242 registros em
`metrics/*.jsonl`:

- `latency_ms` é sempre `0` → `Latência Avg` é sempre `0 ms`.
- `status="error"` nunca ocorre (distribuição: 1236 `success`, 4 `blocked`, 2 `budget_blocked`)
  → `Erros` é sempre `0` e `Taxa Sucesso` é praticamente fixa em ~100 %.
- `tokens_in`/`tokens_out` são sempre `0` (não exibidos, mas confirmam ausência de instrumentação).

Os agentes não instrumentam latência nem tokens, e `lib/metrics.sh` não tem campo nativo
para erro de execução. Os três boxes não têm "config para serem preenchidos" — refletem a
realidade do shell e dos wrappers atuais, não dos agentes.

## Decisão direcional

**Substituir os três boxes mortos por métricas derivadas de dados que já existem**, sem
mexer na coleta. Mantém-se a estrutura `grid-5` (uma linha, cinco boxes) já presente no
layout e no skeleton de loading.

Alternativas descartadas:

- *Apenas remover os três boxes*: descartada — perderia a chance de aproveitar sinais ricos
  já presentes nos JSONL (action, status `blocked`, breakdown por agente).
- *Implementar a coleta faltante (latência/tokens/erros)*: descartada para este escopo.
  Mexeria em `lib/metrics.sh`, `lib/logger.sh`, `commands/braion/agent-wrapup.md` e exigiria
  cooperação de cada agente. Pode ser feito em ciclo futuro independente.

## Métricas finais

Cinco boxes, na ordem do layout:

| # | Box | Fonte | Definição | Sparkline 7d | Cor |
|---|-----|-------|-----------|---|---|
| 1 | **Requests**       | `/api/metrics` `total_requests` | número de linhas do dia (mantido) | sim | `var(--accent)` |
| 2 | **Sessões**        | linhas com `action === "session"` | execuções de agente no dia | sim | `var(--accent)` |
| 3 | **Handoffs**       | linhas com `action ∈ {"handoff_sent","handoff_claimed","handoff_processed"}` | atividade de handoff no dia (agregada) | sim | `var(--accent)` |
| 4 | **Agentes ativos** | `/api/status` (prop `agents` já existente na página) | `state ∈ {"running","idle"}` sobre total — exibido como `N / total`, micro-label "agora" | **não** (point-in-time) | verde se `0` em `state ∈ {"stale","error"}`, senão `var(--warning)` |
| 5 | **Bloqueios**      | linhas com `status ∈ {"blocked","budget_blocked"}` | substitui o box `Erros` morto | sim | `var(--error)` se `>0`, senão `var(--success)` |

Notas de definição:

- **Sessões** usa só `action="session"` (não `init`/`wrapup`) para não triplicar a contagem.
  Cada execução de agente registra uma linha `session`; é a contagem mais limpa de "rodadas".
- **Handoffs** soma os três verbos do ciclo de vida do handoff. É um indicador agregado de
  coordenação no dia, não uma contagem de handoffs únicos. O nome ("Handoffs") reflete isso.
- **Agentes ativos** é o único valor *point-in-time*. Para deixar isso visível sem quebrar a
  grade, o box recebe um sublabel "agora" no lugar do sparkline.
- **Bloqueios** herda a semântica de "algo travou" do antigo `Erros`, mas com dado real.

## Layout

`grid-5` mantido. Uma linha, cinco boxes do mesmo tipo (`MetricBox`). O título da seção
deixa de ser "Hoje" e passa a ser **"Visão geral"** — quatro contadores são "do dia" e um é
"agora"; um título neutro evita a inconsistência sem precisar de duas seções.

O skeleton de loading em `page.tsx` (linhas 91-94) já renderiza cinco placeholders — nenhuma
mudança necessária.

## Mudanças no código

Apenas frontend. Nenhuma alteração em `lib/metrics.sh`, JSONL ou estado dos agentes.

### `dashboard/app/api/metrics/route.ts`
Calcular três campos a partir das mesmas `lines` já lidas:

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

Resposta nova:
`{ date, total_requests, sessions, handoffs, blocked, by_agent }`. Os campos `success`,
`errors` e `avg_latency_ms` saem do payload — não há mais consumidor. Mesma estrutura no
objeto-padrão para arquivo inexistente (zerados). `by_agent` permanece como hoje (continua
contendo `success`/`errors`/`avg_latency_ms` por agente; é dado disponível mas atualmente
sem consumidor de UI — fora do escopo desta reformulação tocar nele).

### `dashboard/app/api/metrics/history/route.ts`
Substituir o payload por dia: `{ date, requests, sessions, handoffs, blocked }`. Os campos
legados `success`, `errors`, `avg_latency_ms` são removidos — não há outro consumidor TS
(verificado: só `MetricsPanel.tsx` lia esses campos, e ele está sendo reescrito).

`AgentMetrics` (breakdown por agente em `/api/metrics`) é mantido sem alteração: ainda
exibido em outras partes do dashboard via `by_agent`.

### `dashboard/app/lib/types.ts`
Substituir `DayMetrics`:

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

Os três campos antigos saem. `AgentMetrics` permanece igual (continua exposto em
`by_agent`).

### `dashboard/app/components/MetricsPanel.tsx`
Reescrita do corpo do componente:

- Aceitar nova prop `agents: AgentStatus[]`.
- Remover `successRate` e os boxes de Taxa Sucesso, Erros, Latência Avg.
- Atualizar `HistoryEntry` para incluir `sessions`, `handoffs`, `blocked`.
- Renderizar os cinco boxes na ordem da tabela acima.
- Para **Agentes ativos**: calcular `healthy = agents.filter(a => a.state==="running" || a.state==="idle").length`, `unhealthy = agents.filter(a => a.state==="stale" || a.state==="error").length`, valor = `${healthy} / ${agents.length}`, cor warning se `unhealthy > 0`, sem `sparkData`.
- Trocar `<h2 className="section-title">Hoje</h2>` por `Visão geral`.

### `dashboard/app/page.tsx`
Única mudança: `<MetricsPanel metrics={metrics} agents={agents} />` (linha 100).

## Critérios de sucesso

1. Ao abrir `/`, a primeira linha mostra os cinco boxes acima com valores diferentes de zero
   coerentes com `cat metrics/<hoje>.jsonl | jq` para os contadores e com `/api/status` para
   Agentes ativos.
2. Sparklines de Requests/Sessões/Handoffs/Bloqueios refletem os últimos 7 dias do JSONL.
3. Trocar a data no seletor recarrega os quatro contadores "do dia"; Agentes ativos permanece
   inalterado (point-in-time).
4. Loading skeleton continua exibindo cinco placeholders alinhados ao layout final.
5. `npm run build` no dashboard sem erros de tipo.

## Fora de escopo

- Instrumentar `latency_ms`, tokens ou status `error` na coleta.
- Adicionar novas dimensões (custo, modelos, por-projeto).
- Mudar a grade do skeleton ou a página de detalhe do agente.
- Reformular o resto da página (filtro de status, cards de agente, botão pausar).
