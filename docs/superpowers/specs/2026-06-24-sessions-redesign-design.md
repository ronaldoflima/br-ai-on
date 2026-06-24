# Redesign da página `/sessions` — feed plano de cards ricos

**Data:** 2026-06-24
**Escopo:** `dashboard/app/sessions/` (frontend). Sem mudanças de API, schema ou coletor.

## Problema

A página `/sessions` lista panes tmux por host. Três frentes de insatisfação:

1. **Estética** — densidade desigual, excesso de badges, card pulsante âmbar cansativo.
2. **Falta informação** — a maioria dos dados úteis (preview de output, o que o agente
   está fazendo, projeto/cwd) só aparece ao expandir cada pane.
3. **Interação/fluxo** — sem forma de filtrar/buscar nem de reduzir o ruído de panes
   `idle`/`shell` quando há muitos panes.

## Decisões de design

- **Estética:** cards ricos, mais visuais, mantendo o dark minimalista do dashboard
  (estilo Linear/Vercel — variáveis em `app/globals.css`).
- **Layout:** feed plano (Abordagem B), não seções aninhadas por host. Host e projeto
  viram chips dentro do card. O aninhamento host→sessão era o principal ruído estrutural.
- **Interação:** foco em navegação (filtro/busca) e redução de ruído (modo "só ativos").
  O SendBox **não** muda — segue no estado expandido, com o gate de estado atual.
- **Branch git fica fora:** não existe na fonte `braion.tmux_sessions`; incluí-lo exigiria
  mexer no coletor de cada host (escopo separado). No lugar do branch, o card mostra o id
  técnico da sessão/janela.

## Arquitetura

Redesign de `page.tsx` + `sessions.module.css`. Extrair `PaneCard.tsx` para manter os
arquivos focados (a anatomia do card é a maior parte da complexidade nova). `lib.ts`,
`SendBox.tsx`, a API (`route.ts`/`pg.ts`) e o schema permanecem intocados.

Todos os dados já chegam no fetch atual (`/api/sessions`); filtros e modo foco são
derivações **client-side** (`useState` + `useMemo`) sobre o array de panes já em memória.
Polling de 15s e abort do fetch anterior seguem como estão.

### Componentes

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `SessionsPage` (`page.tsx`) | Fetch/polling, estado de filtros, ordenação, render do header + seções | `lib.ts`, `PaneCard`, `SendBox` |
| `PaneCard` (`PaneCard.tsx`) | Render de um pane como card rico; expand/collapse; SendBox no expand | `lib.ts`, `SendBox`, `sessions.module.css` |
| `lib.ts` | Tipos e helpers puros (`effectiveView`, `cleanOutput`, `projectName`, `stateRank`, `latestActionFor`) | — (inalterado) |

## Estrutura da página (topo → base)

1. **Header** — título "Sessões tmux" + resumo numérico (total de panes, quantos
   esperando, hosts online/total) + "atualiza a cada 15s".
2. **Barra de controle** — busca de texto; chips de host toggleáveis; toggle "só ativos".
3. **Seção "Precisa de você"** — os panes em `claude_waiting_input`, como cards ricos com
   tratamento âmbar. Mantida no topo, separada do feed.
4. **Feed "Todas as sessões"** — grid plano de cards, ordenado `working → waiting → idle →
   shell` (empate pela transição mais recente, via `stateRank` + `since`), respeitando os
   filtros ativos.

## Anatomia do card rico (`PaneCard`)

Sempre visível (sem expandir):

- **Topo:** badge de estado com dot (`working`/`waiting`/`idle`/`shell`) + chip de projeto
  (`projectName(cwd)`) + chip de host + indicador `attached` quando aplicável.
- **"O que está fazendo":** `view.detail` (de `effectiveView`); quando vazio, cai para a
  última linha não-decorativa de `cleanOutput(last_output)`.
- **Preview de output:** 2–3 linhas de `cleanOutput`, monospace, sutil, sempre visível;
  clicável para expandir.
- **Rodapé:** tempo no estado (`relativeTime(view.since)`), com destaque quando waiting
  passa de 10min (`WAITING_ALERT_MS`); id técnico discreto `session window.pane`.

Expandido: `cwd`, `command` completo, output até 40 linhas, e `SendBox` (com o gate atual:
habilitado só em `claude_waiting_input`/`claude_idle`).

## Controles e comportamento

- **Busca:** filtra por projeto, host, sessão e `window_name` (case-insensitive).
- **Chips de host:** ligam/desligam cada host individualmente.
- **"Só ativos" (modo foco):** esconde `idle` + `shell`; mostra só `working` + `waiting`.
- **Filtros são aditivos** e aplicam-se tanto ao feed quanto à seção "Precisa de você".
- **Estado vazio com filtro:** mensagem "Nenhum pane corresponde aos filtros" em vez de
  sumir o conteúdo.

## Animação (redução de ruído visual)

- Remover o `waiting-pulse` do card inteiro.
- Manter apenas o **dot piscando** (`dot-blink`) no badge `working`.
- Waiting recebe **borda âmbar estática** (sem pulse).
- Alerta de espera longa (> `WAITING_ALERT_MS`) destaca o **tempo**, não o card todo.

## Tratamento de erro / estados de borda

- API já degrada graciosamente (HTTP 200 com listas vazias + `error`); o banner de erro
  e o `SkeletonCards` de loading permanecem.
- Host offline: o feed plano não tem mais cabeçalho por host, então o status online/offline
  passa a viver nos chips de host da barra de controle (host offline = chip esmaecido) e no
  resumo do header.

## Testes

- `lib.test.ts` cobre os helpers puros e segue válido (lib.ts não muda).
- Adicionar testes para qualquer helper de filtragem/ordenação novo que for extraído para
  `lib.ts` (ex.: predicado de busca, predicado "só ativos") — mantendo-os puros para rodar
  com `node --test`.
- Verificação manual: rodar o dashboard, conferir filtro/busca, modo foco, expand/collapse,
  envio via SendBox e o estado vazio.

## Fora de escopo

- Branch git no card (exige mudança no coletor por host).
- Ações rápidas (botões de Enter/sim/ESC) — não priorizadas.
- Campo de envio sempre visível (sem expandir) — não priorizado; SendBox segue no expand.
