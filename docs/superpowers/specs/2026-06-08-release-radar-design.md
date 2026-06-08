# Release Radar — Design

**Data:** 2026-06-08
**Status:** Aprovado (pendente revisão do usuário)
**Tipo:** Novo agente (primeiro vertical slice da iniciativa "Staff leverage agents")

## Contexto

Iniciativa maior: transformar o BR.AI.ON de uso reativo para um conjunto de agentes
autônomos que dão alavancagem de carreira de **Staff Engineer** (situational awareness,
elevar a régua técnica, decisões com dados, influência/comunicação). Esta instância do
projeto é dedicada à carreira; vida pessoal vai para outra instância.

O catálogo completo de cenários está resumido ao final deste doc (Apêndice A). O rollout
escolhido é **vertical slice**: construir um cenário ponta-a-ponta, validar a máquina
(scheduler `alive` + Telegram + memória + diff de estado), e depois clonar o padrão.

**Primeiro cenário:** `release-radar` (A4) — situational awareness multi-repo de PRs/CI.

## Propósito

Vigia multi-repo na org `px-center` que, 2×/dia em dias úteis (e on-demand), entrega um
digest curto do que precisa da **atenção do usuário** como Staff. Silêncio = nada urgente.

Clona o molde do agente `netsuite-monitor` (ciclo de monitoramento numerado, alertas
Telegram por severidade 🔴🟡🟢, regra "silêncio = saúde", memória semântica de padrões).
A única diferença estrutural é a fonte de dados: `gh` CLI / GitHub MCP em vez de Superset.

## Decisões de produto (validadas)

| Dimensão | Decisão |
|----------|---------|
| Escopo de repos | **Onde o usuário atua** — auto-detectar repos do `px-center` onde ele autora/revisa PRs + set crítico fixo (inicia com `px-torre-core`) |
| Foco de atenção | **Os quatro**: (1) PRs esperando review dele, (2) PRs dele travados, (3) PRs do time envelhecendo em repos críticos, (4) CI vermelho na `main` |
| Cadência | **Manhã (~9h) e pós-almoço (~14h)**, seg–sex, via Telegram |
| Validação | 1 semana em calibração (dry-run manual) antes de ligar o cron |

## Arquitetura

### Componentes

```
agents/release-radar/
├── IDENTITY.md            — papel, ciclo de varredura, regras de severidade e de "atenção"
├── config.yaml            — schedule (alive + cron), telegram, collaborators, budget
├── state/
│   ├── last_digest.json   — snapshot do último digest (motor do diff)
│   ├── current_objective.md
│   ├── decisions.md
│   └── heartbeat.json
├── memory/
│   ├── semantic.md        — repos críticos, donos, padrões a ignorar (aprendidos)
│   └── episodic.jsonl
└── handoffs/{inbox,archive}/
```

Criação via `scripts/create-agent.sh` (scaffolding padrão), depois ajuste do IDENTITY e
config conforme abaixo.

### Fonte de dados

Primária: `gh` CLI (já autenticado como `ronaldoflima`, com acesso à org `px-center`).
Fallback: ferramentas `github_*` do personal-mcp-gateway.

Comandos-chave:
- Esperando review: `gh search prs --review-requested=@me --state=open --owner=px-center`
- PRs do usuário: `gh search prs --author=@me --state=open --owner=px-center`
- Detecção de "onde atua": união de autoria + review-requested + envolvimento
  (`--involves=@me`) nos últimos N dias, mais o set crítico fixo do config.
- Status de CI: `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` ou
  `gh pr checks <num> --repo <repo>`.
- CI da main: `gh api repos/{owner}/{repo}/commits/main/check-runs`.

### Configuração (config.yaml)

```yaml
name: release-radar
display_name: Release Radar
domain: [github, code-review, monitoramento]
layer: engineering
model: claude-sonnet-4-6
fallback_model: claude-haiku-4-5

schedule:
  mode: alive
  cron: "0 9,14 * * 1-5"   # 9h e 14h, seg-sex
  priority: 2
  run_alone: false

budget:
  max_sessions_per_day: 4

watch:
  critical_repos:
    - px-center/px-torre-core
  auto_detect:
    org: px-center
    involves_days: 30        # janela para "onde você atua"
  aging_days: 5              # PR aberto há mais que isso = envelhecendo
  approved_stale_hours: 24   # PR aprovado parado mais que isso = travado

integrations:
  telegram:
    enabled: true

collaborators:
  - agent: staff-reviewer    # futuro (C1) — revisão profunda sob demanda
    reason: Escalar revisão técnica de PR específico quando o radar destaca algo crítico
```

## Fluxo de uma sessão

1. **Init**: carrega IDENTITY + `config.yaml` + `state/last_digest.json` + memória.
2. **Coleta** (via `gh`):
   a. Repos-alvo = `critical_repos` ∪ auto-detectados (`--involves=@me` na janela).
   b. PRs com review solicitado ao usuário.
   c. PRs do usuário abertos: idade, status CI, mergeable/conflito, aprovado-mas-parado.
   d. Em repos críticos: PRs abertos > `aging_days`; CI vermelho na `main`.
3. **Classifica severidade**:
   - 🔴 CI vermelho na `main` de repo crítico · PR do usuário aprovado e parado
     bloqueando release · review urgente em caminho crítico.
   - 🟡 esperando review dele · PR dele com conflito/CI vermelho · PR do time envelhecendo.
   - 🟢 nada acima do threshold.
4. **Diff vs snapshot**: compara com `last_digest.json`; destaca apenas o novo/mudado
   desde a última execução (PR novo, CI que virou vermelho, PR que foi aprovado).
5. **Saída**: se houver 🔴/🟡 novo → envia digest no Telegram (`bash lib/telegram.sh send`).
   Se nada novo acima do threshold → silêncio (apenas registra no estado).
6. **Wrapup**: salva `last_digest.json`, registra decisões, atualiza memória semântica se
   aprendeu algo (repo a ignorar, dono, padrão), loga métricas via `logger.sh`.

### Formato do digest (Telegram)

```
📡 Release Radar — 08/06 09:00

🔴 1 crítico
• px-torre-core: CI vermelho na main (commit a1b2c3, "fix conciliation")

🟡 3 precisam de você
• [review] px-motor #482 "Add retry to webhook" — aberto 2d, te aguarda
• [seu PR] px-cortex #91 aprovado há 1d, ainda não mergeado
• [envelhecendo] px-torre-core #310 aberto há 7d (Maria)

(silêncio nos demais repos = ok)
```

## Tratamento de erro

- `gh` retorna 401/token expirado → alerta Telegram bloqueante imediato (regra do
  `netsuite-monitor`: credencial é bloqueante).
- Repo inacessível / 404 → registra no log, remove do alvo, segue.
- Rate limit da API GitHub → backoff, registra nota, não falha a sessão inteira.
- Sem snapshot anterior (primeira run) → trata tudo como "novo", mas marca como
  calibração (não alarma 🔴 falso na primeira vez).

## Observabilidade

- Log JSONL via `lib/logger.sh` (`action`, `message`, `metadata` com contagem de PRs).
- Métricas diárias (nº PRs avaliados, nº alertas, severidades) para alimentar o loop
  `evaluate.sh` → `optimize.sh` depois (calibrar falso-positivo de threshold).

## Plano de validação

1. Criar agente com `mode: disabled` inicialmente.
2. Rodar 1 sessão manual (dry-run) e inspecionar o digest gerado.
3. Calibrar `aging_days`, `approved_stale_hours` e o set crítico por ~1 semana.
4. Quando o digest estiver com sinal alto e baixo ruído → mudar para `mode: alive`.

## Fora de escopo (YAGNI)

- Comentar/aprovar PRs automaticamente (isso é o futuro `staff-reviewer`, C1).
- Revisão profunda de conteúdo de código (idem C1).
- Métricas históricas de velocity/DORA (cenário separado).
- Outras orgs além de `px-center`.

## Apêndice A — Catálogo de cenários (roadmap)

Vigias no molde `netsuite-monitor`, agentes de dados, revisão e comunicação:

- **A. Situational awareness**: A1 `bugsnag-watcher`, A2 `datadog-watcher`
  (precisa MCP Datadog), A3 `flag-sentinel` (px-torre-core), **A4 `release-radar` ← este**.
- **B. Decisões com dados**: B1 `conciliation-analyst` (FinancialConciliation),
  B2 `kpi-correlator`, B3 `leadership-desk`.
- **C. Elevar a régua**: C1 `staff-reviewer`, C2 `pattern-detector`.
- **D. Influência**: D1 `weekly-staff-digest` (fan-in via orchestrator), D2 `decision-logger`.
- **Transversal**: job de incident-triage (orchestrator fan-out/fan-in);
  loop `evaluate`→`optimize` (auto-ajuste de thresholds).

Cada cenário terá seu próprio ciclo spec → plano → implementação.
