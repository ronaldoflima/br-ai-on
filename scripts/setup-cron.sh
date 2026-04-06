#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRON_SCRIPT="${PROJECT_DIR}/lib/agent-cron.sh"
LOG_FILE="${PROJECT_DIR}/logs/agent-cron.log"
CRON_ENTRY="* * * * * /bin/bash ${CRON_SCRIPT} >> ${LOG_FILE} 2>&1"

echo "=== Setup: braion-cron ==="
echo ""

# 1. Verificar dependencias
if ! command -v tmux &>/dev/null; then
  echo "[!] tmux nao encontrado — instale com: apt install tmux"
  exit 1
fi
echo "[ok] tmux disponivel"

if ! command -v claude &>/dev/null; then
  echo "[!] claude CLI nao encontrado no PATH"
  exit 1
fi
echo "[ok] claude CLI disponivel ($(command -v claude))"

# 2. Verificar script principal
if [[ ! -f "$CRON_SCRIPT" ]]; then
  echo "[!] Script nao encontrado: $CRON_SCRIPT"
  exit 1
fi
echo "[ok] Script: $CRON_SCRIPT"

# 3. Garantir diretorio de logs
mkdir -p "$(dirname "$LOG_FILE")"
echo "[ok] Diretorio de logs: $(dirname "$LOG_FILE")"

# 4. Verificar se entrada ja existe
if crontab -l 2>/dev/null | grep -qF "$CRON_SCRIPT"; then
  echo ""
  echo "[ok] Entrada ja existe no crontab:"
  crontab -l | grep "$CRON_SCRIPT"
  echo ""
  read -rp "Quer recriar a entrada? [s/N] " answer
  if [[ "$(echo "$answer" | tr '[:upper:]' '[:lower:]')" != "s" ]]; then
    echo "Nada a fazer."
    exit 0
  fi
  # Remove entrada existente antes de recriar
  crontab -l 2>/dev/null | grep -vF "$CRON_SCRIPT" | crontab -
fi

# 5. Adicionar entrada no crontab
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

# 6. Verificar instalacao
if crontab -l 2>/dev/null | grep -qF "$CRON_SCRIPT"; then
  echo ""
  echo "=== Instalado ==="
  crontab -l | grep "$CRON_SCRIPT"
else
  echo ""
  echo "=== Erro: entrada nao encontrada no crontab ==="
  exit 1
fi

echo ""
echo "Comandos uteis:"
echo "  crontab -l                           # listar entradas"
echo "  crontab -e                           # editar manualmente"
echo "  tail -f ${LOG_FILE}   # logs ao vivo"
echo "  touch ${PROJECT_DIR}/.paused         # pausar agentes"
echo "  rm ${PROJECT_DIR}/.paused            # retomar agentes"
