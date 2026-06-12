#!/usr/bin/env bash
# tg-fila.sh <chat_id>
#
# Comando /fila do telegram-bridge: lê a fila de prioridades de
# braion.task_queue (rank IS NOT NULL = ativas) e imprime no stdout a
# mensagem para o chat. Em seguida dispara queue-sync.sh em background e,
# se as TASKS mudarem, manda uma segunda mensagem "Fila atualizada".
#
# stdout = mensagem imediata para o chat. rc=0 exceto erro real de PG.
set -euo pipefail

CHAT_ID="${1:?chat_id obrigatório}"

BRAION="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_SYNC="$HOME/tmux-orchestrator/queue-sync.sh"

# ── PG (roda na VPS; 127.0.0.1, senha via ~/.pgpass) ─────────────────────────
PSQL=(psql -X -q -w -tA -F '|' -v ON_ERROR_STOP=1)
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-braion}" PGUSER="${PGUSER:-braion}"

# Corpo da fila (só as linhas de task) — vazio se não há ativas.
# Formato por task: 2 linhas. Devolve via stdout, uma task por bloco.
fila_body() {
  "${PSQL[@]}" -f - <<'SQL'
SELECT
  rank,
  CASE WHEN due IS NOT NULL AND due < current_date THEN '1' ELSE '0' END AS vencido,
  title,
  coalesce(prioridade, ''),
  score,
  coalesce(projeto, '')
FROM braion.task_queue
WHERE rank IS NOT NULL
ORDER BY rank
LIMIT 10;
SQL
}

# Horário do último sync (max updated_at), formato HH:MM.
fila_sync_time() {
  "${PSQL[@]}" -f - <<'SQL'
SELECT to_char(max(updated_at) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
FROM braion.task_queue;
SQL
}

# Renderiza as linhas de task a partir do output de fila_body (stdin).
# Saída: bloco de texto pronto (sem header/rodapé).
render_body() {
  local rank vencido title prioridade score projeto
  while IFS='|' read -r rank vencido title prioridade score projeto; do
    [ -z "$rank" ] && continue
    local meta="$prioridade"
    [ -n "$score" ] && meta="${meta:+$meta · }$score"
    [ -n "$projeto" ] && meta="${meta:+$meta · }$projeto"
    if [ "$vencido" = "1" ]; then
      printf '%s. ⚠️ *%s*\n' "$rank" "$title"
    else
      printf '%s. %s\n' "$rank" "$title"
    fi
    [ -n "$meta" ] && printf '   %s\n' "$meta"
  done
}

# Mensagem completa: header + corpo + rodapé opcional.
# $1 = corpo já renderizado; $2 = rodapé (pode ser vazio).
render_message() {
  local body="$1" footer="${2:-}" sync_time
  sync_time=$(fila_sync_time 2>/dev/null || echo '??:??')
  if [ -z "$body" ]; then
    echo "📋 Fila vazia — nenhuma task ativa."
    return
  fi
  printf '📋 *Fila* (sync %s)\n\n%s' "$sync_time" "$body"
  [ -n "$footer" ] && printf '\n%s' "$footer"
}

# ── Render imediato ──────────────────────────────────────────────────────────
body=$(fila_body | render_body)
render_message "$body" "⏳ atualizando em background…"
