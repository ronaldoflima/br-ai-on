#!/usr/bin/env bash
# scripts/setup_pg_tunnel.sh — Configura o Mac para se conectar ao Postgres da VPS
# via SSH tunnel persistente (autossh + LaunchAgent).
#
# Não faz nada destrutivo: cria arquivos novos, mostra o que faria e exige
# confirmação antes de gravar nos diretórios do usuário (~/Library/LaunchAgents,
# ~/.pg_service.conf, ~/.pgpass).
#
# Pré-requisitos:
#   - autossh instalado (`brew install autossh`)
#   - SSH config com host alias `vps-gateway` funcionando
#   - Postgres ativo na VPS escutando em 127.0.0.1:5432
#
# Uso:
#   scripts/setup_pg_tunnel.sh status      # mostra estado atual
#   scripts/setup_pg_tunnel.sh install     # gera plist, pg_service.conf, pgpass
#   scripts/setup_pg_tunnel.sh start       # carrega LaunchAgent
#   scripts/setup_pg_tunnel.sh stop        # descarrega LaunchAgent
#   scripts/setup_pg_tunnel.sh uninstall   # remove plist (não toca .pgpass/service)
set -euo pipefail

HOST_ALIAS="${BRAION_PG_HOST_ALIAS:-vps-gateway}"
LOCAL_PORT="${BRAION_PG_LOCAL_PORT:-5433}"
REMOTE_PORT="${BRAION_PG_REMOTE_PORT:-5432}"
SERVICE_NAME="${BRAION_PG_SERVICE:-braion}"
PG_USER="${BRAION_PG_USER:-braion}"
PG_DB="${BRAION_PG_DB:-braion}"

PLIST_LABEL="com.braion.pgtunnel"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
PG_SERVICE_FILE="$HOME/.pg_service.conf"
PGPASS_FILE="$HOME/.pgpass"
LOG_FILE="$HOME/Library/Logs/braion-pgtunnel.log"

if [[ $# -lt 1 ]]; then
  echo "uso: setup_pg_tunnel.sh status|install|start|stop|uninstall" >&2
  exit 2
fi
cmd="$1"

require_autossh() {
  if ! command -v autossh >/dev/null 2>&1; then
    echo "autossh não encontrado. Instale com: brew install autossh" >&2
    exit 1
  fi
}

prompt_password() {
  # Lê senha do PG; mantém em variável (não loga).
  if [[ -n "${BRAION_PG_PASSWORD:-}" ]]; then
    echo "$BRAION_PG_PASSWORD"
    return
  fi
  read -rs -p "Senha do usuário Postgres '$PG_USER' na VPS: " pwd_in
  echo "" >&2
  echo "$pwd_in"
}

status() {
  echo "Host alias:      $HOST_ALIAS"
  echo "Local port:      $LOCAL_PORT"
  echo "Remote port:     $REMOTE_PORT"
  echo "PG service name: $SERVICE_NAME"
  echo "Plist:           $PLIST_PATH ($([[ -f "$PLIST_PATH" ]] && echo "EXISTS" || echo "missing"))"
  echo "pg_service.conf: $PG_SERVICE_FILE ($([[ -f "$PG_SERVICE_FILE" ]] && echo "EXISTS" || echo "missing"))"
  echo "pgpass:          $PGPASS_FILE ($([[ -f "$PGPASS_FILE" ]] && echo "EXISTS" || echo "missing"))"
  if launchctl print "gui/$(id -u)/$PLIST_LABEL" >/dev/null 2>&1; then
    echo "LaunchAgent:     LOADED"
  else
    echo "LaunchAgent:     not loaded"
  fi
  if nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
    echo "Tunnel port:     port $LOCAL_PORT OPEN (tunnel parece ativo)"
  else
    echo "Tunnel port:     port $LOCAL_PORT CLOSED"
  fi
}

install_files() {
  require_autossh
  mkdir -p "$(dirname "$PLIST_PATH")" "$(dirname "$LOG_FILE")"

  echo "→ gerando $PLIST_PATH"
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v autossh)</string>
    <string>-M</string><string>0</string>
    <string>-N</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-L</string><string>${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}</string>
    <string>${HOST_ALIAS}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AUTOSSH_PIDFILE</key><string>/tmp/braion-pgtunnel.pid</string>
    <key>AUTOSSH_POLL</key><string>30</string>
  </dict>
</dict>
</plist>
PLIST

  if [[ ! -f "$PG_SERVICE_FILE" ]] || ! grep -q "^\[${SERVICE_NAME}\]" "$PG_SERVICE_FILE" 2>/dev/null; then
    echo "→ adicionando entrada [${SERVICE_NAME}] em $PG_SERVICE_FILE"
    {
      [[ -f "$PG_SERVICE_FILE" ]] && echo ""
      echo "[${SERVICE_NAME}]"
      echo "host=127.0.0.1"
      echo "port=${LOCAL_PORT}"
      echo "dbname=${PG_DB}"
      echo "user=${PG_USER}"
    } >> "$PG_SERVICE_FILE"
    chmod 600 "$PG_SERVICE_FILE"
  else
    echo "→ entrada [${SERVICE_NAME}] já existe em $PG_SERVICE_FILE (skip)"
  fi

  if [[ ! -f "$PGPASS_FILE" ]] || ! grep -q ":127.0.0.1:${LOCAL_PORT}:${PG_DB}:${PG_USER}:" "$PGPASS_FILE" 2>/dev/null; then
    echo "→ adicionando linha em $PGPASS_FILE"
    local pwd
    pwd=$(prompt_password)
    {
      [[ -f "$PGPASS_FILE" ]] && echo ""
      echo "127.0.0.1:${LOCAL_PORT}:${PG_DB}:${PG_USER}:${pwd}"
    } >> "$PGPASS_FILE"
    chmod 600 "$PGPASS_FILE"
  else
    echo "→ pgpass já tem entrada para 127.0.0.1:${LOCAL_PORT}:${PG_DB}:${PG_USER} (skip)"
  fi

  echo ""
  echo "Arquivos prontos. Próximos passos:"
  echo "  scripts/setup_pg_tunnel.sh start"
  echo "  PGSERVICE=${SERVICE_NAME} psql -c 'SELECT 1'"
}

start_tunnel() {
  if [[ ! -f "$PLIST_PATH" ]]; then
    echo "Plist não existe. Rode 'install' antes." >&2
    exit 1
  fi
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH"
  echo "LaunchAgent carregado. Aguardando porta ${LOCAL_PORT}..."
  for i in $(seq 1 20); do
    if nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
      echo "→ porta ${LOCAL_PORT} OK em ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "Porta não respondeu em 20s. Veja log: $LOG_FILE" >&2
  exit 2
}

stop_tunnel() {
  [[ -f "$PLIST_PATH" ]] && launchctl unload "$PLIST_PATH" || true
  echo "LaunchAgent descarregado"
}

uninstall() {
  stop_tunnel
  [[ -f "$PLIST_PATH" ]] && rm "$PLIST_PATH" && echo "removido $PLIST_PATH"
  echo "Mantidos: $PG_SERVICE_FILE, $PGPASS_FILE (remova manualmente se quiser)"
}

case "$cmd" in
  status)    status ;;
  install)   install_files ;;
  start)     start_tunnel ;;
  stop)      stop_tunnel ;;
  uninstall) uninstall ;;
  *) echo "comando inválido: $cmd" >&2; exit 2 ;;
esac
