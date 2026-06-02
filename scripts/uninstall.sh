#!/bin/bash
# Reverte tudo que install.sh + setup-cron.sh criam:
#   - serviço (systemd no Linux / processo `next start` no Mac)
#   - entrada do crontab (lib/agent-cron.sh)
#   - symlink de commands (cli_commands_install_dir/braion)
#   - hooks stop-like registrados no settings do backend
# NÃO remove: deps de sistema (node/npm/git) nem o diretório do repo.

OS="$(uname -s)"
SERVICE_FILE="$HOME/.config/systemd/user/braion.service"

# ── Localiza o repo (funciona rodando local ou via curl) ────────────────────────
REPO_DIR="${REPO_DIR:-}"
if [ -z "$REPO_DIR" ]; then
  _src="${BASH_SOURCE[0]:-}"
  if [ -n "$_src" ] && [ -f "$(dirname "$_src")/../lib/cli.sh" ]; then
    REPO_DIR="$(cd "$(dirname "$_src")/.." && pwd)"
  else
    REPO_DIR="$HOME/br-ai-on"
  fi
fi

# Carrega a fronteira CLI se disponível (paths de commands/hooks dependem dela)
HAVE_CLI=false
if [ -f "$REPO_DIR/lib/cli.sh" ]; then
  source "$REPO_DIR/lib/cli.sh"
  HAVE_CLI=true
fi

# ── 1. Serviço / processo do dashboard ──────────────────────────────────────────
if [ "$OS" = "Linux" ]; then
  if [ -f "$SERVICE_FILE" ]; then
    systemctl --user stop braion.service 2>/dev/null || true
    systemctl --user disable braion.service 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload
    systemctl --user reset-failed 2>/dev/null || true
    echo "[ok] braion.service removido."
  else
    echo "[skip] braion.service não encontrado."
  fi
else
  # macOS / outros: install.sh sobe via nohup + next start
  if pgrep -f "next start" >/dev/null 2>&1; then
    pkill -f "next start" 2>/dev/null || true
    sleep 1
    echo "[ok] Servidor braion (next start) finalizado."
  else
    echo "[skip] Servidor braion (next start) não está rodando."
  fi
fi

# ── 2. Crontab (lib/agent-cron.sh) ──────────────────────────────────────────────
if crontab -l 2>/dev/null | grep -qF "agent-cron.sh"; then
  _new_cron="$(crontab -l 2>/dev/null | grep -vF "agent-cron.sh")"
  if printf '%s\n' "$_new_cron" | crontab - 2>/tmp/braion-crontab-err; then
    echo "[ok] Entrada do crontab (agent-cron.sh) removida."
  else
    echo "[!] Falha ao escrever no crontab: $(cat /tmp/braion-crontab-err 2>/dev/null)"
    if [ "$OS" = "Darwin" ]; then
      echo "    macOS exige Full Disk Access para alterar o crontab."
      echo "    Rode manualmente no SEU terminal:"
      echo "      crontab -l | grep -vF 'agent-cron.sh' | crontab -"
    fi
  fi
  rm -f /tmp/braion-crontab-err
else
  echo "[skip] Nenhuma entrada de crontab para agent-cron.sh."
fi

# ── 3. Symlink de commands ──────────────────────────────────────────────────────
if [ "$HAVE_CLI" = true ]; then
  COMMANDS_LINK="$(cli_commands_install_dir)/braion"
  if [ -L "$COMMANDS_LINK" ] || [ -e "$COMMANDS_LINK" ]; then
    rm -rf "$COMMANDS_LINK"
    echo "[ok] Commands removidos: $COMMANDS_LINK"
  else
    echo "[skip] Commands não instalados em $COMMANDS_LINK"
  fi
else
  echo "[skip] lib/cli.sh indisponível — pulei commands e hooks (defina REPO_DIR)."
fi

# ── 4. Hooks stop-like no settings do backend ───────────────────────────────────
if [ "$HAVE_CLI" = true ]; then
  for hook in agent-idle-hook.sh telegram-hook.sh; do
    cli_hook_unregister stop-like "$REPO_DIR/scripts/$hook"
    case $? in
      0) echo "[ok] hook $hook desregistrado (ou já ausente)." ;;
      1) echo "[!] falha ao desregistrar $hook (verifique jq/python3)." ;;
      2) echo "[skip] $hook — backend não suporta hooks." ;;
    esac
  done
fi

echo ""
echo "Uninstall concluído. Repo e dependências de sistema (node/git) foram mantidos."
