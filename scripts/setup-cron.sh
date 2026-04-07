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

# 7. Registrar Stop hook no settings.json do Claude Code
HOOK_SCRIPT="${PROJECT_DIR}/scripts/agent-idle-hook.sh"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo ""
echo "=== Stop hook (detecção de idle) ==="

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "[!] $SETTINGS_FILE nao encontrado — configure manualmente:"
  echo "    Adicione agent-idle-hook.sh no bloco hooks.Stop do seu settings.json"
elif ! command -v jq &>/dev/null; then
  echo "[!] jq nao encontrado — verifique manualmente se o hook esta registrado em $SETTINGS_FILE"
elif jq -e '.hooks.Stop[]?.hooks[]? | select(.command | contains("agent-idle-hook.sh"))' "$SETTINGS_FILE" >/dev/null 2>&1; then
  echo "[ok] agent-idle-hook.sh ja registrado em $SETTINGS_FILE"
else
  echo "[..] Registrando agent-idle-hook.sh em $SETTINGS_FILE"
  python3 - "$SETTINGS_FILE" "$HOOK_SCRIPT" <<'PYEOF'
import sys, json

settings_path, hook_script = sys.argv[1], sys.argv[2]

with open(settings_path) as f:
    settings = json.load(f)

settings.setdefault("hooks", {}).setdefault("Stop", [])

stop_hooks = settings["hooks"]["Stop"]
if not stop_hooks:
    stop_hooks.append({"matcher": ".*", "hooks": []})

new_hook = {"type": "command", "command": hook_script, "timeout": 5}
stop_hooks[0].setdefault("hooks", []).append(new_hook)

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"[ok] Hook registrado em {settings_path}")
PYEOF
fi

echo ""
echo "Comandos uteis:"
echo "  crontab -l                           # listar entradas"
echo "  crontab -e                           # editar manualmente"
echo "  tail -f ${LOG_FILE}   # logs ao vivo"
echo "  touch ${PROJECT_DIR}/.paused         # pausar agentes"
echo "  rm ${PROJECT_DIR}/.paused            # retomar agentes"
echo "  ls ~/.config/br-ai-on/idle/          # sessoes em idle aguardando wrapup"
