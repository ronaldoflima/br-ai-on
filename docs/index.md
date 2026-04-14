# BR.AI.ON — Documentação

> Ecossistema de agentes AI pessoais com backend AI plugável

## Guias

- [Visão Geral](overview.md) — Arquitetura, ciclo de vida, modos de schedule
- [Integração Telegram](telegram.md) — Setup e comandos da bridge Telegram

## Referência

- [Agentes](agents.md) — Catálogo completo de agentes com domínios e funções
- [Dashboard](dashboard.md) — Dashboard web Next.js 15: terminal, file explorer, filtros, API
- [Bibliotecas (lib/)](libs.md) — Scripts utilitários: cron, handoffs, jobs, logging, memória
- [Commands (Skills)](commands.md) — agent-init, agent-wrapup, agent-handoff, orchestrator
- [Scripts](scripts.md) — Automação: install, cron, telegram, plugins
- [Handoffs e Jobs](handoffs-and-jobs.md) — Sistema de comunicação e coordenação entre agentes

## Estrutura do Repositório

```
br-ai-on/
├── agents/              — Agentes (identity, config, state, memory, handoffs)
│   ├── _defaults/       — Agentes versionados no git
│   ├── shared/          — Estado compartilhado (jobs, schedule_state)
│   └── <nome>/          — Agentes do usuário (gitignored)
├── commands/braion/     — Skills do Claude Code
├── lib/                 — Scripts utilitários
├── scripts/             — Automação e setup
├── logs/                — Logs JSONL por agente/dia
├── metrics/             — Métricas JSONL
├── dashboard/           — Next.js 15 (porta 3040)
├── docs/                — Esta documentação
├── tests/               — Testes de integração
├── CLAUDE.md            — Instruções do projeto
├── AGENTS.md            — Regras operacionais
└── USER.md              — Perfil do usuário
```

## Versão

Dashboard: 1.3.2 | Última atualização dos docs: 2026-04-14
