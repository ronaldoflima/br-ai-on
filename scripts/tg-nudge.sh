#!/usr/bin/env bash
# tg-nudge.sh <reply_text> <user_text> <chat_id>
#
# Helper do telegram-bridge (fase 4 do tmux-agents-orchestrator): extrai o
# marcador ⟦nudge host:session:window.pane⟧ do texto da notificação respondida
# e enfileira o texto do usuário em braion.tmux_actions. O coletor do host
# alvo executa via tmux send-keys com gate de estado.
#
# stdout = mensagem para o chat (sucesso/aviso). rc=0 exceto erro real de
# parse/validação/PG. Valores SEMPRE via psql -v (nunca interpolação no SQL).
set -euo pipefail

REPLY_TEXT="${1:?reply_text obrigatório}"
USER_TEXT="${2:?user_text obrigatório}"
CHAT_ID="${3:?chat_id obrigatório}"

# ── Parse do marcador ─────────────────────────────────────────────────────────
# tmux proíbe ':' e '.' em nomes de sessão → split simples é seguro.
marker=$(printf '%s' "$REPLY_TEXT" | grep -o '⟦nudge [^⟧]*⟧' | head -1) \
    || { echo "❌ marcador de nudge não encontrado na mensagem respondida"; exit 1; }
body=${marker#⟦nudge }
body=${body%⟧}

host=${body%%:*}
rest=${body#*:}
session=${rest%:*}
pane_ref=${rest##*:}
window_index=${pane_ref%%.*}
pane_index=${pane_ref##*.}

case "$host" in
    mac|vps-mcpgw|vps-pessoal) ;;
    *) echo "❌ host inválido no marcador: $host"; exit 1 ;;
esac
case "$window_index$pane_index" in
    *[!0-9]*) echo "❌ janela/pane inválidos no marcador: $pane_ref"; exit 1 ;;
esac
[ -n "$session" ] || { echo "❌ sessão vazia no marcador"; exit 1; }

# ── PG (roda na VPS; 127.0.0.1, senha via ~/.pgpass) ─────────────────────────
PSQL=(psql -X -q -w -tA -v ON_ERROR_STOP=1)
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-braion}" PGUSER="${PGUSER:-braion}"

# Duplicata: já existe ação pendente para este pane → recusa com aviso (rc=0).
pending=$("${PSQL[@]}" \
    -v host="$host" -v session="$session" \
    -v window_index="$window_index" -v pane_index="$pane_index" \
    -c "SELECT count(*) FROM braion.tmux_actions
         WHERE host = :'host' AND session = :'session'
           AND window_index = :'window_index'::int
           AND pane_index = :'pane_index'::int AND status = 'pending'")
if [ "$pending" != "0" ]; then
    echo "⚠️ já existe ação pendente para $host $session $pane_ref — aguarde o coletor executar"
    exit 0
fi

"${PSQL[@]}" \
    -v host="$host" -v session="$session" \
    -v window_index="$window_index" -v pane_index="$pane_index" \
    -v action_text="$USER_TEXT" -v requested_by="telegram:$CHAT_ID" \
    -c "INSERT INTO braion.tmux_actions
          (host, session, window_index, pane_index, action_text, requested_by)
        VALUES (:'host', :'session', :'window_index'::int, :'pane_index'::int,
                :'action_text', :'requested_by')" >/dev/null

echo "✓ na fila para $host $session $pane_ref (executa no próximo ciclo do coletor)"
