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

source "$PROJECT_DIR/lib/cli.sh"
if ! cli_check_available; then
  echo "[!] $CLI_BACKEND CLI nao encontrado no PATH"
  exit 1
fi
echo "[ok] $CLI_BACKEND CLI disponivel ($(command -v "$CLI_BACKEND"))"

# 2. Verificar script principal
if [[ ! -f "$CRON_SCRIPT" ]]; then
  echo "[!] Script nao encontrado: $CRON_SCRIPT"
  exit 1
fi
echo "[ok] Script: $CRON_SCRIPT"

# 3. Garantir diretorio de logs
mkdir -p "$(dirname "$LOG_FILE")"
echo "[ok] Diretorio de logs: $(dirname "$LOG_FILE")"

# 4. Instalar/verificar entrada no crontab
if crontab -l 2>/dev/null | grep -qF "$CRON_SCRIPT"; then
  echo "[ok] Crontab já configurado"
else
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
  if crontab -l 2>/dev/null | grep -qF "$CRON_SCRIPT"; then
    echo "[ok] Crontab instalado"
  else
    echo "[!] Erro ao instalar crontab"
    exit 1
  fi
fi

# 7. Registrar hooks stop-like no backend (se suportado)
echo ""
echo "=== stop-like hooks ($CLI_BACKEND) ==="

register_hook_wrapper() {
  local hook_script="$1" timeout="$2" label="$3"
  cli_hook_register stop-like "$hook_script" "$timeout"
  case $? in
    0) echo "[ok] $label registrado" ;;
    1) echo "[!] falha ao registrar $label (verifique $(cli_hook_config_path) e jq)" ;;
    2) echo "[skip] $label — backend $CLI_BACKEND não suporta hooks ainda" ;;
  esac
}

register_hook_wrapper "${PROJECT_DIR}/scripts/agent-idle-hook.sh"    5  "agent-idle-hook.sh"
register_hook_wrapper "${PROJECT_DIR}/scripts/telegram-hook.sh"      15 "telegram-hook.sh"

echo ""
echo "Comandos uteis:"
echo "  crontab -l                           # listar entradas"
echo "  crontab -e                           # editar manualmente"
echo "  tail -f ${LOG_FILE}   # logs ao vivo"
echo "  touch ${PROJECT_DIR}/.paused         # pausar agentes"
echo "  rm ${PROJECT_DIR}/.paused            # retomar agentes"
echo "  ls ${IDLE_DIR:-\$HOME/.config/br-ai-on/idle}/  # sessoes idle aguardando wrapup"
