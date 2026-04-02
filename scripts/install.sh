#!/bin/bash
set -e

REPO_URL="git@github.com:(usuário)flima/br-ai-on.git"
REPO_DIR="${REPO_DIR:-$HOME/br-ai-on}"
DASHBOARD_DIR="$REPO_DIR/dashboard"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/deploy-prod.log"
SERVICE_FILE="$HOME/.config/systemd/user/braion.service"

log() {
  mkdir -p "$LOG_DIR"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if [ -d "$REPO_DIR/.git" ]; then
  log "Repositório já existe, fazendo pull..."
  git -C "$REPO_DIR" pull origin main --quiet
  log "Pull concluído"
else
  echo "Clonando repositório em $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR"
  git -C "$REPO_DIR" checkout main
  log "Repositório clonado"

  log "Instalando dependências..."
  cd "$DASHBOARD_DIR"
  npm install
  log "Dependências instaladas"

  log "Executando build inicial..."
  node --env-file=../.env ./node_modules/.bin/next build --turbopack 2>&1 | tee -a "$LOG_FILE"
  log "Build concluído"
fi

if [ ! -f "$SERVICE_FILE" ]; then
  mkdir -p "$(dirname "$SERVICE_FILE")"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=BR-AI-ON Dashboard (Next.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=$DASHBOARD_DIR
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable braion.service
  systemctl --user start braion.service
  log "Serviço braion.service criado, habilitado e iniciado"
fi

cd "$REPO_DIR"
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Nova versão detectada: $LOCAL -> $REMOTE"

git pull origin main --quiet
log "Pull concluído"

cd "$DASHBOARD_DIR"
node --env-file=../.env ./node_modules/.bin/next build --turbopack 2>&1 | tee -a "$LOG_FILE"
log "Build concluído"

systemctl --user restart braion.service
log "Serviço reiniciado"
sleep 2
journalctl --user -u braion.service -n 20 --no-pager
