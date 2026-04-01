---
name: agent-handoff
description: Processa handoffs pendentes do agente, executa as ações necessárias e termina a sessão
---

# Agent Handoff — Processador de Handoffs

Você foi iniciado para processar handoffs pendentes. Ao terminar, a sessão encerra.

## Contexto da Sessão

O prompt de inicialização contém:
- `Agent:` — seu nome
- `Handoff:` — path completo do arquivo de handoff a processar
- `BR.AI.ON base:` — raiz do repositório br-ai-on
- `Working directory:` — diretório do projeto (pode ser diferente do BR.AI.ON base)

Use `BR.AI.ON base` para todos os paths de estado/memória/logs (`agents/`, `lib/`, `logs/`).
Use `Working directory` como base para edições no projeto.

## 1. Inicializar

```bash
BRAION="<BR.AI.ON base>"
AGENT="<nome>"

# Heartbeat de início
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" \
  '{last_ping: $ts, agent: $a, status: "processing"}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

## 2. Carregar Identidade

Leia em ordem:
- `<BR.AI.ON base>/agents/<nome>/IDENTITY.md` — sua identidade e regras
- `<BR.AI.ON base>/agents/<nome>/state/current_objective.md`
- `<BR.AI.ON base>/agents/<nome>/state/decisions.md`
- `<BR.AI.ON base>/agents/<nome>/memory/semantic.md`

## 3. Processar o Handoff

O arquivo do handoff foi passado no prompt (`Handoff:`). Use-o diretamente.

**a) Claim** — mova para in_progress antes de qualquer trabalho:
```bash
new_path=$(bash "$BRAION/lib/handoff.sh" claim "$AGENT" "<handoff_file>")
```
Use `$new_path` em todas as operações subsequentes.

**b) Obter diretório de artefatos** — use para qualquer arquivo gerado (relatórios, exports, etc.):
```bash
artifacts_dir=$(bash "$BRAION/lib/handoff.sh" artifacts-dir "$AGENT" "<ho_id>")
```
Salve todos os artefatos gerados em `$artifacts_dir/`. Informe os paths no resumo final.

**c) Leia o arquivo** (frontmatter + corpo) e identifique: `from`, `expects`, `description`, `context`, `expected`

**d) Execute** a ação conforme seu SOUL e o conteúdo do handoff

**e) Responda ou notifique** — apenas se `expects` for `action` ou `review` E você tiver resultado concreto:

Para responder ao agente remetente:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" "<from>" info "<ho_id>" "<resumo>" "<resultado>" "<próximos passos>"
```

Para notificar o usuário (quando o resultado exige ação humana):
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" user info "<ho_id>" "<resumo>" "<resultado>" "<próximos passos>"
```

> **NUNCA responda a handoffs com `expects: info`** — são notificações unidirecionais. O cron arquiva automaticamente sem iniciar sessão. Responder cria loop infinito de ACKs.
>
> Prefira `to: user` a `to: <agente>` quando o destinatário real é o usuário. Use `to: <agente>` só quando o outro agente precisa executar algo.

**f) Archive** ao concluir:
```bash
bash "$BRAION/lib/handoff.sh" archive "$AGENT" "$new_path"
```

## 4. Salvar Estado

- Atualize `<BR.AI.ON base>/agents/<nome>/state/decisions.md` com decisões tomadas
- Se aprendeu algo novo, atualize `<BR.AI.ON base>/agents/<nome>/memory/semantic.md`
- Se houve mudança de foco, atualize `<BR.AI.ON base>/agents/<nome>/state/current_objective.md`

```bash
bash "$BRAION/lib/memory.sh" log_episodic "<ação>" "<contexto>" "<resultado>" <importancia>
bash "$BRAION/lib/logger.sh" "$AGENT" "Handoffs processados" '{"count": N}'
```

## 5. Notificar

Se a ação for crítica ou precisar de atenção do usuário, envie via Telegram:
```
mcp__personal-mcp-gateway__gateway_send_notification
```

## 6. Heartbeat Final e Encerramento

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" \
  '{last_ping: $ts, agent: $a, status: "completed"}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

Após salvar o heartbeat, mate a sessão tmux para liberar o slot:
```bash
tmux kill-session -t "$(tmux display-message -p '#S')" 2>/dev/null || true
```
