#!/usr/bin/env bash
# lib/feature-request.sh — Envia um feature request para o hawkai-maintainer
#
# Uso interativo:
#   bash lib/feature-request.sh
#
# Uso direto:
#   bash lib/feature-request.sh "Título da feature" "Contexto adicional"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TITLE="${1:-}"
CONTEXT="${2:-}"

if [ -z "$TITLE" ]; then
  echo "=== Feature Request para HawkAI Maintainer ==="
  echo ""
  printf "Descreva a feature: "
  read -r TITLE
  echo ""
  printf "Contexto adicional (Enter para pular): "
  read -r CONTEXT
fi

filepath=$(bash "$SCRIPT_DIR/handoff.sh" send "user" "hawkai-maintainer" "action" "null" \
  "$TITLE" \
  "${CONTEXT:-Solicitado diretamente pelo usuário via feature-request.sh}" \
  "Implementar a feature no projeto ~/hawkai e notificar via Telegram quando concluído")

echo ""
echo "Feature request enviado: $(basename "$filepath")"
echo "O HawkAI Maintainer será acionado no próximo ciclo do cron (até 5min)."
