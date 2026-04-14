# Dashboard

Dashboard web para monitoramento e interação com o ecossistema BR.AI.ON. Construído com Next.js 15, roda na porta 3040.

**Versão atual**: 1.3.2

## Stack

- Next.js 15 (App Router)
- TypeScript
- CSS Modules
- Autenticação TOTP (2FA)

## Páginas

| Rota | Descrição |
|------|-----------|
| `/` | Home com overview geral |
| `/agents` | Lista de agentes com filtros por domínio, modo e layer |
| `/handoffs` | Handoffs com filtros por status, agente e layer |
| `/terminal` | Terminal web com acesso a sessões tmux |
| `/logs` | Visualização de logs JSONL |
| `/memories` | Memórias dos agentes |
| `/integrations` | Status das integrações MCP |
| `/wizard` | Wizard de criação de agentes |
| `/login` | Autenticação TOTP |

## Terminal Web

Página principal de interação com sessões tmux dos agentes. Features:

- **Sessões tmux**: painel lateral colapsável com lista de sessões e indicadores de status (dot colorido)
- **File Explorer**: painel de navegação de arquivos com drag-to-resize, integrado via endpoint `/api/terminal/files`
- **File Viewer**: visualizador de arquivos selecionados no explorer
- **Input de texto**: envio de comandos para sessões tmux ativas, com batching de keystrokes em modo direto (PR #33)
- **Auto-scroll**: scroll automático para novas linhas de output (PR #26)
- **SSE otimizado**: capturePane e getCursorInfo executados em paralelo via Promise.all (PR #33)
- **Text selection toggle**: botão para habilitar/desabilitar seleção de texto no terminal
- **URL linkification**: URLs no output do terminal são convertidas em links clicáveis
- **Mobile**: scroll touch otimizado, layout responsivo

## Componentes

| Componente | Função |
|------------|--------|
| `Sidebar` | Navegação principal com label dinâmico via `backendLabel()`, Integrações na nav principal, modo colapsado persistido em localStorage |
| `FileExplorer` | Árvore de diretórios com navegação hierárquica |
| `FileViewer` | Visualizador de conteúdo de arquivos |
| `FilterSection` | Filtros reutilizáveis com collapse, contadores e ordenação por relevância |
| `AgentCard` | Card de agente com status, heartbeat e métricas |
| `MetricsPanel` | Painel de métricas com sparklines |
| `icons` | Ícones SVG customizados (chevrons, etc.) |

## API Endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/agents` | GET | Lista agentes com configs e estados |
| `/api/agents/[name]/terminal` | POST | Envia comandos para sessão tmux |
| `/api/terminal` | POST | Interação direta com terminal |
| `/api/terminal/files` | GET | Navegação de filesystem com proteção path traversal |
| `/api/terminal/stream` | GET | Stream SSE de output do terminal |
| `/api/handoffs` | GET | Lista handoffs (filename regex aceita dígitos no sufixo, ex: superset-kpi-v3) |
| `/api/logs` | GET | Lista logs |
| `/api/metrics` | GET | Métricas agregadas |
| `/api/artifacts` | GET | Artefatos de agentes |
| `/api/memories` | GET | Memórias dos agentes |
| `/api/health` | GET | Health check |
| `/api/status` | GET | Status geral do sistema |
| `/api/version` | GET | Versão atual |
| `/api/auth` | POST | Autenticação TOTP |
| `/api/pause` | POST | Pausa/resume de agentes |

## Segurança

- Autenticação via TOTP (setup com `scripts/setup-totp.js`)
- Proteção contra path traversal nos endpoints de filesystem
- APIs assíncronas com `spawn` (substituído `execSync` por segurança e performance)
- Validação de config com `config-validator.ts`

## Abstração de Backend (cli-backend)

O dashboard espelha `lib/cli.sh` em TypeScript via dois módulos:

| Módulo | Escopo | Exports principais |
|--------|--------|--------------------|
| `cli-backend-client.ts` | Client-safe | `CLI_BACKEND`, `backendLabel()`, `defaultModel()`, `fallbackModel()`, `validModels()`, `validPermissionModes()` |
| `cli-backend.ts` | Server-side | Re-exporta client + `configDir()`, `commandsInstallDir()`, `projectsDir()` |

Nenhum arquivo fora destes módulos contém modelos, paths ou strings hardcoded do backend. `CLI_BACKEND` (env var) alterna entre backends sem rebuild.

## Config Validator

O dashboard valida configs de agentes em tempo real. Campos validados:

- **Obrigatórios**: name, display_name, version, model, fallback_model, domain, schedule, budget
- **runtime.permission_mode**: auto, confirm, bypass (genéricos) + valores nativos do backend (retrocompat `runtime.claude.*` aceita)
- **Modelos**: validação contra `ALL_VALID_MODELS` (união de todos backends) para não invalidar configs ao trocar `CLI_BACKEND`
- **layer**: campo opcional para categorização (infrastructure, business, service, auxiliary)
- **capabilities**: array de strings descrevendo o que o agente pode fazer

## Scripts

```bash
npm run dev    # Dev server na porta 3040
npm run build    # Build de produção
npm run start    # Produção na porta 3040
npm run release  # Bump de versão via release.sh
```

Variáveis de ambiente carregadas de `../.env` (raiz do projeto).
