# Tasks Commands

Extração e persistência de tarefas a partir de canais de comunicação.

## Setup

```
/tasks:config init
```

## Available Commands

- [config](./config.md) — Configurar variáveis do plugin (email, destinos, limites)
- [extract](./extract.md) — Extrai tarefas de emails, Teams e calendário
- [update](./update.md) — Orquestra persistência e gera relatório
- [save-notion](./save-notion.md) — Salva tarefas no Notion
- [save-obsidian](./save-obsidian.md) — Salva tarefas no Obsidian

## Config

Todas as variáveis personalizáveis ficam em `tasks-config.json`. Para compartilhar o plugin, basta o destinatário rodar `/tasks:config init` para configurar seus próprios valores.
