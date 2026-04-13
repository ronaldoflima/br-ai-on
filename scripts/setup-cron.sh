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

# 7. Registrar Stop hooks no settings.json do Claude Code
SETTINGS_FILE="$HOME/.claude/settings.json"

echo ""
echo "=== Stop hooks ==="

register_stop_hook() {
  local hook_script="$1" timeout="$2" label="$3"

  if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo "[!] $SETTINGS_FILE nao encontrado — adicione $label manualmente"
    return
  fi

  if ! command -v jq &>/dev/null; then
    echo "[!] jq nao encontrado — verifique $label manualmente em $SETTINGS_FILE"
    return
  fi

  local needle
  needle=$(basename "$hook_script")

  if jq -e ".hooks.Stop[]?.hooks[]? | select(.command | contains(\"$needle\"))" "$SETTINGS_FILE" >/dev/null 2>&1; then
    echo "[ok] $label ja registrado"
    return
  fi

  python3 - "$SETTINGS_FILE" "$hook_script" "$timeout" <<'PYEOF'
import sys, json
settings_path, hook_script, timeout = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(settings_path) as f:
    s = json.load(f)
s.setdefault("hooks", {}).setdefault("Stop", [])
stop = s["hooks"]["Stop"]
if not stop:
    stop.append({"matcher": ".*", "hooks": []})
stop[0].setdefault("hooks", []).append({"type": "command", "command": hook_script, "timeout": timeout})
with open(settings_path, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF
  echo "[ok] $label registrado"
}

register_stop_hook "${PROJECT_DIR}/scripts/agent-idle-hook.sh"    5  "agent-idle-hook.sh"
register_stop_hook "${PROJECT_DIR}/scripts/telegram-hook.sh"      15 "telegram-hook.sh"

echo ""
echo "Comandos uteis:"
echo "  crontab -l                           # listar entradas"
echo "  crontab -e                           # editar manualmente"
echo "  tail -f ${LOG_FILE}   # logs ao vivo"
echo "  touch ${PROJECT_DIR}/.paused         # pausar agentes"
echo "  rm ${PROJECT_DIR}/.paused            # retomar agentes"
echo "  ls ~/.config/br-ai-on/idle/          # sessoes em idle aguardando wrapup"
