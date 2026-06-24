# Redesign da `/sessions` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a página `/sessions` num feed plano de cards ricos, com busca, filtro por host e modo foco, sem mexer em API/schema/coletor.

**Architecture:** Lógica de filtragem/derivação vira helper puro em `lib.ts` (testável com `node --test`). O card rico é extraído para `PaneCard.tsx` (apresentação, dono do próprio estado de expandir). `page.tsx` reescreve: header com resumo, barra de controle, seção "Precisa de você" e feed plano. Todos os dados já vêm do fetch atual; filtros são derivações client-side.

**Tech Stack:** Next.js (App Router, client component), React `useState`/`useMemo`, CSS Modules, testes com `node --test --experimental-strip-types`.

---

## File Structure

- `dashboard/app/sessions/lib.ts` — **Modify.** Adiciona helpers puros: `isActiveState`, `matchesQuery`, `whatsHappening`. Resto inalterado.
- `dashboard/app/sessions/lib.test.ts` — **Modify.** Testes dos 3 helpers novos.
- `dashboard/app/sessions/PaneCard.tsx` — **Create.** Card rico de um pane; dono do estado expand.
- `dashboard/app/sessions/page.tsx` — **Modify (reescrita).** Header + barra de controle + seções; usa `PaneCard`.
- `dashboard/app/sessions/sessions.module.css` — **Modify.** Estilos de card/controle/chips; remove pulse do card.
- `dashboard/app/sessions/SendBox.tsx` — **Inalterado.**
- `dashboard/app/api/sessions/*` — **Inalterado.**

Comando de teste (rodar a partir de `dashboard/`):
`node --test --experimental-strip-types app/sessions/lib.test.ts`

---

## Task 1: Helpers puros de filtragem em `lib.ts`

**Files:**
- Modify: `dashboard/app/sessions/lib.ts`
- Test: `dashboard/app/sessions/lib.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `app/sessions/lib.test.ts` (e incluir `isActiveState, matchesQuery, whatsHappening` no import de `./lib.ts` no topo do arquivo):

```ts
test("isActiveState: só working e waiting são ativos", () => {
  assert.equal(isActiveState("claude_working"), true);
  assert.equal(isActiveState("claude_waiting_input"), true);
  assert.equal(isActiveState("claude_idle"), false);
  assert.equal(isActiveState("shell"), false);
});

test("matchesQuery: vazio casa tudo; busca em host/session/window_name/projeto", () => {
  const p = pane({ host: "vps-mcpgw", session: "braion", window_name: "logs", cwd: "/home/x/br-ai-on" });
  assert.equal(matchesQuery(p, ""), true);
  assert.equal(matchesQuery(p, "  "), true);
  assert.equal(matchesQuery(p, "BRAION"), true); // case-insensitive
  assert.equal(matchesQuery(p, "br-ai-on"), true); // projeto via cwd
  assert.equal(matchesQuery(p, "logs"), true); // window_name
  assert.equal(matchesQuery(p, "nada"), false);
});

test("whatsHappening: prefere detail; cai pra última linha do output; null se nada", () => {
  const withDetail = pane({ state: "claude_working", state_detail: "rodando testes", last_output: "ruído" });
  assert.equal(whatsHappening(withDetail), "rodando testes");
  const noDetail = pane({ state: "shell", state_detail: null, last_output: "linha 1\nlinha final" });
  assert.equal(whatsHappening(noDetail), "linha final");
  const empty = pane({ state: "shell", state_detail: null, last_output: null });
  assert.equal(whatsHappening(empty), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd dashboard && node --test --experimental-strip-types app/sessions/lib.test.ts`
Expected: FAIL — `isActiveState is not defined` (e os demais).

- [ ] **Step 3: Implementar os helpers**

Adicionar ao fim de `app/sessions/lib.ts`:

```ts
const ACTIVE_STATES = ["claude_working", "claude_waiting_input"];

export function isActiveState(state: string): boolean {
  return ACTIVE_STATES.includes(state);
}

export function matchesQuery(p: TmuxPane, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [p.host, p.session, p.window_name ?? "", projectName(p.cwd) ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function whatsHappening(p: TmuxPane): string | null {
  const view = effectiveView(p);
  if (view.detail) return view.detail;
  return cleanOutput(p.last_output, 1)[0] ?? null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd dashboard && node --test --experimental-strip-types app/sessions/lib.test.ts`
Expected: PASS — 11 testes (8 antigos + 3 novos).

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/sessions/lib.ts dashboard/app/sessions/lib.test.ts
git commit -m "feat(sessions): helpers puros isActiveState/matchesQuery/whatsHappening"
```

---

## Task 2: Componente `PaneCard`

**Files:**
- Create: `dashboard/app/sessions/PaneCard.tsx`

Sem teste unitário (componente de apresentação; verificação via `next build` na Task 5). O card é dono do próprio estado de expandir — `defaultExpanded` parte `true` para os cards de "Precisa de você".

- [ ] **Step 1: Criar o arquivo**

Conteúdo completo de `app/sessions/PaneCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { relativeTime, cn } from "../lib/utils";
import styles from "./sessions.module.css";
import SendBox from "./SendBox";
import {
  effectiveView,
  cleanOutput,
  projectName,
  whatsHappening,
  latestActionFor,
  type TmuxPane,
  type TmuxAction,
  type PaneView,
} from "./lib";

const WAITING_ALERT_MS = 10 * 60 * 1000;
const SENDABLE_STATES = ["claude_waiting_input", "claude_idle"];
const GATE_HINT = "gate do coletor só aceita waiting/idle";

const STATE_META: Record<string, { label: string; badge: string; pulse?: boolean }> = {
  claude_working: { label: "working", badge: styles.badgeWorking, pulse: true },
  claude_waiting_input: { label: "waiting input", badge: styles.badgeWaiting },
  claude_idle: { label: "idle", badge: styles.badgeIdle },
  shell: { label: "shell", badge: styles.badgeShell },
};

function isWaitingTooLong(view: PaneView): boolean {
  return (
    view.state === "claude_waiting_input" &&
    Date.now() - new Date(view.since).getTime() > WAITING_ALERT_MS
  );
}

function waitingSinceLabel(view: PaneView): string {
  const time = new Date(view.since).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return view.detail ? `esperando desde ${time} — ${view.detail}` : `esperando desde ${time}`;
}

interface PaneCardProps {
  pane: TmuxPane;
  actions: TmuxAction[];
  highlight?: boolean;
  defaultExpanded?: boolean;
}

export default function PaneCard({ pane, actions, highlight, defaultExpanded }: PaneCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const view = effectiveView(pane);
  const meta = STATE_META[view.state] ?? STATE_META.shell;
  const proj = projectName(pane.cwd);
  const doing = whatsHappening(pane);
  const preview = cleanOutput(pane.last_output, expanded ? 40 : 3);
  const sendable = SENDABLE_STATES.includes(view.state);
  const techId = `${pane.session} ${pane.window_index}.${pane.pane_index}${
    pane.window_name ? ` ${pane.window_name}` : ""
  }`;

  return (
    <div className={cn(styles.card, highlight && styles.cardWaiting)}>
      <div className={styles.cardTop}>
        <span className={cn(styles.badge, meta.badge)} title={`fonte: ${view.source}`}>
          <span className={cn(styles.dot, meta.pulse && styles.dotPulse)} />
          {meta.label}
        </span>
        {proj && <span className={styles.projTag}>{proj}</span>}
        <span className={cn(styles.badge, styles.badgeShell)}>{pane.host}</span>
        {pane.attached && <span className={cn(styles.badge, styles.badgeShell)}>attached</span>}
      </div>

      {doing && <div className={styles.cardDoing}>{doing}</div>}

      {preview.length > 0 && (
        <div
          className={cn(styles.preview, expanded && styles.previewExpanded)}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Clique para recolher" : "Clique para expandir"}
        >
          {preview.join("\n")}
        </div>
      )}

      <div className={styles.cardFoot}>
        <span className={cn(styles.stateTime, isWaitingTooLong(view) && styles.waitingLong)}>
          {view.state === "claude_waiting_input"
            ? waitingSinceLabel(view)
            : relativeTime(view.since)}
        </span>
        <span className={styles.techId}>{techId}</span>
      </div>

      {expanded && (
        <div className={styles.cardExpand}>
          {pane.cwd && <span className={styles.paneCwd}>{pane.cwd}</span>}
          {pane.command && <span className="mono-sm">{pane.command}</span>}
          <SendBox
            pane={pane}
            enabled={sendable}
            disabledReason={sendable ? undefined : `agente está ${meta.label} — ${GATE_HINT}`}
            lastAction={latestActionFor(pane, actions)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd dashboard && ./node_modules/.bin/tsc --noEmit -p . 2>&1 | grep -i "sessions/PaneCard" || echo "PaneCard sem erros de tipo"`
Expected: "PaneCard sem erros de tipo".
(Se o projeto não tiver `tsc` standalone, isso é coberto pelo `next build` na Task 5.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/sessions/PaneCard.tsx
git commit -m "feat(sessions): componente PaneCard (card rico, dono do expand)"
```

---

## Task 3: Reescrever `page.tsx` — header, barra de controle, feed plano

**Files:**
- Modify: `dashboard/app/sessions/page.tsx` (substituição completa)

- [ ] **Step 1: Substituir o arquivo inteiro**

Conteúdo completo de `app/sessions/page.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { cn } from "../lib/utils";
import styles from "./sessions.module.css";
import PaneCard from "./PaneCard";
import {
  effectiveView,
  isActiveState,
  matchesQuery,
  stateRank,
  type TmuxPane,
  type TmuxAction,
} from "./lib";

interface HostStatus {
  host: string;
  last_run: string;
  online: boolean;
}

const KNOWN_HOSTS = ["mac", "vps-mcpgw", "vps-pessoal"];
const POLL_MS = 15000;

function paneKey(p: TmuxPane): string {
  return `${p.host}:${p.session}:${p.window_index}.${p.pane_index}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<TmuxPane[]>([]);
  const [hosts, setHosts] = useState<HostStatus[]>([]);
  const [actions, setActions] = useState<TmuxAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [hiddenHosts, setHiddenHosts] = useState<Set<string>>(new Set());
  const [activeOnly, setActiveOnly] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;
    const fetchSessions = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/sessions", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setSessions(data.sessions || []);
          setHosts(data.hosts || []);
          setActions(data.actions || []);
          setError(data.error || "");
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Erro de conexão com a API");
          setLoading(false);
        });
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, POLL_MS);
    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const hostList = useMemo(() => {
    const extra = [...new Set([...sessions.map((p) => p.host), ...hosts.map((h) => h.host)])]
      .filter((h) => !KNOWN_HOSTS.includes(h))
      .sort();
    return [...KNOWN_HOSTS, ...extra];
  }, [sessions, hosts]);

  const hostStatus = useMemo(() => new Map(hosts.map((h) => [h.host, h])), [hosts]);

  const visible = useMemo(
    () =>
      sessions.filter(
        (p) =>
          matchesQuery(p, query) &&
          !hiddenHosts.has(p.host) &&
          (!activeOnly || isActiveState(effectiveView(p).state)),
      ),
    [sessions, query, hiddenHosts, activeOnly],
  );

  const feed = useMemo(
    () =>
      [...visible].sort((a, b) => {
        const va = effectiveView(a);
        const vb = effectiveView(b);
        const rank = stateRank(va.state) - stateRank(vb.state);
        if (rank !== 0) return rank;
        return new Date(vb.since).getTime() - new Date(va.since).getTime();
      }),
    [visible],
  );

  const waiting = useMemo(
    () =>
      visible
        .filter((p) => effectiveView(p).state === "claude_waiting_input")
        .sort(
          (a, b) =>
            new Date(effectiveView(a).since).getTime() -
            new Date(effectiveView(b).since).getTime(),
        ),
    [visible],
  );

  const onlineCount = hosts.filter((h) => h.online).length;

  const toggleHost = (host: string) => {
    setHiddenHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Sessões tmux</h1>
        <span className="text-muted-xs">
          {sessions.length} panes · {waiting.length} esperando · {onlineCount}/{hosts.length || hostList.length} hosts · atualiza 15s
        </span>
      </div>

      {error && <div className={cn(styles.errorBox, "mb-md")}>{error}</div>}

      {loading ? (
        <SkeletonCards count={6} />
      ) : (
        <div className={styles.wrapper}>
          <div className={styles.controlBar}>
            <input
              className={styles.searchInput}
              placeholder="buscar projeto, host, sessão…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.hostChips}>
              {hostList.map((host) => {
                const off = hiddenHosts.has(host);
                const offline = !hostStatus.get(host)?.online;
                return (
                  <button
                    key={host}
                    className={cn(styles.hostChip, off && styles.hostChipOff, offline && styles.hostChipOffline)}
                    onClick={() => toggleHost(host)}
                    title={offline ? "host offline" : off ? "mostrar host" : "ocultar host"}
                  >
                    {host}
                  </button>
                );
              })}
            </div>
            <button
              className={cn(styles.focusToggle, activeOnly && styles.focusToggleOn)}
              onClick={() => setActiveOnly((v) => !v)}
              title="Mostrar só working + waiting"
            >
              só ativos
            </button>
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Precisa de você ({waiting.length})</h2>
            {waiting.length === 0 ? (
              <div className={styles.allClear}>Nenhum agente precisa de você ✓</div>
            ) : (
              <div className={styles.grid}>
                {waiting.map((pane) => (
                  <PaneCard
                    key={paneKey(pane)}
                    pane={pane}
                    actions={actions}
                    highlight
                    defaultExpanded
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Todas as sessões ({feed.length})</h2>
            {feed.length === 0 ? (
              <div className={styles.allClear}>Nenhum pane corresponde aos filtros.</div>
            ) : (
              <div className={styles.grid}>
                {feed.map((pane) => (
                  <PaneCard key={paneKey(pane)} pane={pane} actions={actions} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit (build validado na Task 5)**

```bash
git add dashboard/app/sessions/page.tsx
git commit -m "feat(sessions): feed plano + barra de controle (busca/host/foco)"
```

---

## Task 4: Estilos em `sessions.module.css`

**Files:**
- Modify: `dashboard/app/sessions/sessions.module.css`

- [ ] **Step 1: Remover estilos obsoletos**

Remover do arquivo os blocos que pertenciam às seções por host e ao card pulsante:
`.hostSection`, `.hostOffline`, `.hostHeader`, `.hostName`, `.hostMeta`, `.sessionGrid`,
`.sessionCard`, `.sessionHeader`, `.sessionName`, `.needsYou`, `.needsYouTitle`,
`.needsYouCard`, `.paneItem`, `.paneLine`, `.paneLineWaiting`, `.paneLineName`,
`.paneDetail`, `.paneMeta`, `.paneId`, `.stateTime` (será redefinido abaixo),
`.emptyHost`, e a keyframe `@keyframes waiting-pulse`.

Manter: `.wrapper`, `.allClear`, `.projTag`, `.waitingLong`, `.paneCwd`, `.badge` e
variantes, `.dot`, `.dotPulse`, `@keyframes dot-blink`, `.preview`, `.previewExpanded`,
`.errorBox`, e todo o bloco `/* ---- SendBox ---- */` até o fim, incluindo o
`@media (max-width: 768px)` (ajustado no Step 2).

- [ ] **Step 2: Adicionar os estilos novos**

Adicionar (logo após o bloco `.wrapper`):

```css
/* ---- Barra de controle ---- */

.controlBar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.searchInput {
  flex: 1;
  min-width: 200px;
  font-size: 13px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  color: var(--text-primary);
}

.searchInput:focus {
  outline: none;
  border-color: var(--accent);
}

.hostChips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.hostChip {
  font-family: monospace;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
}

.hostChip:hover {
  border-color: var(--accent);
}

.hostChipOff {
  opacity: 0.4;
  text-decoration: line-through;
}

.hostChipOffline {
  border-style: dashed;
}

.focusToggle {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.focusToggle:hover {
  border-color: var(--accent);
}

.focusToggleOn {
  background: rgba(59, 130, 246, 0.13);
  border-color: var(--accent);
  color: var(--accent);
}

/* ---- Seções e grid ---- */

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sectionTitle {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
}

/* ---- Card rico ---- */

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cardWaiting {
  border-color: var(--warning);
  background: rgba(245, 158, 11, 0.06);
}

.cardTop {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cardDoing {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.cardFoot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.stateTime {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.techId {
  font-family: monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.cardExpand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 3: Ajustar o media query do fim do arquivo**

Substituir o bloco `@media (max-width: 768px)` existente por:

```css
@media (max-width: 768px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/sessions/sessions.module.css
git commit -m "style(sessions): cards ricos, barra de controle, remove pulse do card"
```

---

## Task 5: Build e verificação manual

**Files:** nenhum (validação).

- [ ] **Step 1: Rodar os testes puros**

Run: `cd dashboard && node --test --experimental-strip-types app/sessions/lib.test.ts`
Expected: PASS — 11 testes.

- [ ] **Step 2: Build de produção (typecheck + compilação)**

Run: `cd dashboard && npm run build 2>&1 | tail -20`
Expected: build conclui sem erro; rota `/sessions` aparece na lista de rotas compiladas.

- [ ] **Step 3: Verificação manual (dev server)**

Run: `cd dashboard && npm run dev` e abrir `http://localhost:3040/sessions`. Conferir:
- Header mostra resumo (panes / esperando / hosts).
- Busca filtra os cards; chips de host ocultam/mostram; chip de host offline aparece tracejado.
- "só ativos" esconde idle/shell.
- "Precisa de você" lista os waiting já expandidos, com SendBox visível.
- Card não-waiting expande ao clicar no preview e mostra cwd/command/SendBox.
- Envio via SendBox funciona (estado "enviado → entregue").
- Filtro que zera resultado mostra "Nenhum pane corresponde aos filtros."

- [ ] **Step 4: Commit final (se algum ajuste de verificação)**

```bash
git add -A dashboard/app/sessions
git commit -m "fix(sessions): ajustes da verificação manual do redesign" || echo "nada a commitar"
```

---

## Self-Review (preenchido na escrita)

- **Cobertura do spec:** header com resumo (Task 3) · barra de controle busca/host/foco (Task 3 + CSS Task 4) · "Precisa de você" (Task 3) · feed plano ordenado (Task 3) · anatomia do card: estado+tempo, "o que faz", preview sempre visível, projeto/host (Task 2) · branch fora (techId no lugar — Task 2) · pulse removido, dot mantido (Task 4) · estado vazio filtrado (Task 3) · host offline migra pros chips (Task 3 + Task 4) · API/lib/SendBox intocados. ✓
- **Placeholders:** nenhum — todo passo de código tem código completo.
- **Consistência de tipos:** `isActiveState`/`matchesQuery`/`whatsHappening` definidos na Task 1 e usados com a mesma assinatura nas Tasks 2–3; `PaneCard` props (`pane`, `actions`, `highlight`, `defaultExpanded`) batem entre Task 2 e Task 3; `effectiveView`/`stateRank` reusados do `lib.ts` existente.
```
