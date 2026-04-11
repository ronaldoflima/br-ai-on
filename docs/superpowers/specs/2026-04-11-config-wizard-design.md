# Config Wizard para Agentes — Design Spec

**Data:** 2026-04-11
**Branch:** feat/default-agent-config-override
**Status:** Aprovado

---

## Objetivo

Criar um formulário guiado (wizard) para editar configurações de agentes existentes, permitindo ao usuário saber o que é possível configurar e como, com histórico de versões.

---

## Acesso

- Na aba **Config** da página de detalhes do agente, adicionar botão **"Wizard"**
- O botão navega para `/agents/[name]/config-wizard`

> A aba Config já existe em `/agents/[name]/page.tsx` com 5 tabs: Overview, Config, Soul, Memory, Terminal.

---

## Layout

### Desktop — split-pane

```
┌─────────────────────────────┬──────────────────────┐
│  Config Wizard: <nome>       │  YAML preview        │
│  ─────────────────────────  │  ──────────────────  │
│  ▼ Identidade               │  name: braion         │
│    campos...                 │  display_name: ...    │
│  ▶ Modelo                   │  ...                  │
│  ▶ Runtime                  │                       │
│  ▶ Capabilities              │  [Copiar YAML]        │
│  ▶ Schedule                 │                       │
│  ▶ Budget                   │                       │
│  ▶ Integrações              │                       │
│  ▶ Colaboradores            │                       │
│                              │                       │
│  [Salvar nova versão]        │                       │
└─────────────────────────────┴──────────────────────┘
```

### Mobile — abas

Duas abas no topo: **Formulário** e **YAML**. Mesmo conteúdo, layout empilhado. Controlado via `@media` CSS sem dependências externas.

---

## Seções do Accordion

Cada seção ao expandir exibe:
1. **Legenda** — descrição do propósito da seção e dos campos
2. **Campos** — inputs com label (nome do campo YAML), descrição curta e validação inline

| Seção | Campos |
|---|---|
| **Identidade** | `name` (readonly), `display_name`, `domain` (tags), `layer` (select), `version` |
| **Modelo** | `model` (select), `fallback_model` (select) |
| **Runtime** | `permission_mode` (select), `working_directory`, `command` |
| **Capabilities** | lista editável de strings (add/remove) |
| **Schedule** | `mode` (select), `interval` (condicional se mode=alive), `priority`, `run_alone` |
| **Budget** | `max_tokens_per_session`, `max_sessions_per_day` |
| **Integrações** | toggle por integração + campos específicos de cada uma |
| **Colaboradores** | lista de objetos editáveis (add/remove) |

Seções com erro de validação exibem indicador visual no título mesmo quando fechadas.

---

## Histórico de Versões

### Estrutura de arquivos

```
agents/<nome>/
  config.yaml                        ← versão ativa
  .config-history/
    2026-04-10T14-30-00.yaml
    2026-04-09T09-15-22.yaml
    ...
```

- Máximo de **10 versões** no histórico. Versões além do limite são descartadas (a mais antiga primeiro).
- O diretório `.config-history/` é criado automaticamente no primeiro save.

### Seletor de versão na aba Config

- Dropdown **"Versão"** no topo da aba Config listando timestamps disponíveis
- Ao selecionar versão antiga: exibe o YAML daquela versão com botão **"Restaurar esta versão"**

---

## Fluxo de Dados

### Carregamento

1. `GET /api/agents/[name]/config` — carrega `config.yaml` atual (rota existente)
2. `GET /api/agents/[name]/config-history` — lista versões do histórico *(nova rota)*
3. Formulário pré-preenchido com valores atuais

### Edição em tempo real

- Estado local React (`useState`) por campo
- YAML preview gerado client-side com lib `yaml` (já no projeto)
- Sem chamadas ao servidor durante edição

### Salvar nova versão

1. Validação client-side (reutiliza `config-validator.ts`)
2. `POST /api/agents/[name]/config` com o novo YAML *(modifica rota existente para adicionar versioning)*
   - Servidor move `config.yaml` atual para `.config-history/<timestamp>.yaml`
   - Escreve novo `config.yaml`
   - Descarta versões além do limite (10)
3. Redirect para `/agents/[name]` aba Config com toast de sucesso

### Restaurar versão

- `POST /api/agents/[name]/config/restore` com `{ timestamp }` *(nova rota)*
- Mesmo fluxo do save: versão atual vai pro histórico, versão selecionada vira o `config.yaml`

---

## Validação

### Client-side (inline, em tempo real)

| Campo | Regra |
|---|---|
| `name` | readonly — não editável |
| `version` | formato semver `X.Y.Z` |
| `domain` | mínimo 1 item |
| `model` / `fallback_model` | valor da lista de modelos válidos |
| `schedule.interval` | formato `\d+(m\|h\|d)`, obrigatório se `mode=alive` |
| `budget.max_tokens_per_session` | número ≥ 1000 |
| `budget.max_sessions_per_day` | número ≥ 1 |

- Erro exibido abaixo do campo ao sair do input (`onBlur`)
- Botão **"Salvar nova versão"** desabilitado enquanto houver erros

### Server-side

- `config-validator.ts` reutilizado no servidor antes de escrever o arquivo
- Falha retorna HTTP 400 com mensagem do campo problemático
- Toast de erro na UI

### Outros erros

| Cenário | Comportamento |
|---|---|
| Falha ao escrever arquivo | Toast com erro técnico; arquivo original não é substituído |
| Agente não encontrado | Redirect para `/agents` com toast de aviso |
| Histórico cheio | Descarte silencioso do mais antigo; save não é bloqueado |

---

## Arquivos a criar/modificar

### Novos

- `dashboard/app/agents/[name]/config-wizard/page.tsx` — página principal do wizard
- `dashboard/app/agents/[name]/config-wizard/ConfigWizard.tsx` — componente accordion
- `dashboard/app/agents/[name]/config-wizard/YamlPreview.tsx` — painel de preview
- `dashboard/app/agents/[name]/config-wizard/sections/` — um arquivo por seção do accordion
- `dashboard/app/agents/[name]/config-wizard/config-wizard.module.css` — estilos responsive
- `dashboard/app/api/agents/[name]/config-history/route.ts` — GET histórico
- `dashboard/app/api/agents/[name]/config/restore/route.ts` — POST restaurar versão

### Modificados

- `dashboard/app/api/agents/[name]/config/route.ts` — adicionar versioning ao POST
- Aba Config da página do agente — adicionar botão "Wizard" e seletor de versões

---

## Fora de escopo

- Edição do campo `name` (identificador imutável do agente)
- Sincronização bidirecional form ↔ YAML (YAML é somente preview, não editável)
- Diff visual entre versões (pode ser adicionado futuramente)
