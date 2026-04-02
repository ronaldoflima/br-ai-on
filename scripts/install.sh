#!/bin/bash
set -e

REPO_URL="git@github.com:(usuário)flima/br-ai-on.git"
REPO_DIR="${REPO_DIR:-$HOME/br-ai-on}"
DASHBOARD_DIR="$REPO_DIR/dashboard"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/deploy-prod.log"
SERVICE_FILE="$HOME/.config/systemd/user/braion.service"
OS="$(uname -s)"

log() {
  mkdir -p "$LOG_DIR"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

service_start() {
  if [ "$OS" = "Linux" ]; then
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
      log "Serviço braion.service criado e habilitado"
    fi
    systemctl --user restart braion.service
    log "Serviço reiniciado"
    sleep 2
    journalctl --user -u braion.service -n 20 --no-pager
  else
    log "Iniciando servidor..."
    pkill -f "next start" 2>/dev/null || true
    sleep 1
    cd "$DASHBOARD_DIR"
    nohup node --env-file=../.env ./node_modules/.bin/next start --port 3040 --hostname 0.0.0.0 >> "$LOG_FILE" 2>&1 &
    sleep 3
    log "Servidor iniciado em http://localhost:3040"
    tail -20 "$LOG_FILE"
  fi
}

# — Setup do repo
if [ -d "$REPO_DIR/.git" ]; then
  log "Repositório já existe, fazendo pull..."
  git -C "$REPO_DIR" pull origin main --quiet
  log "Pull concluído"
else
  log "Clonando repositório em $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR"
  git -C "$REPO_DIR" checkout main
  log "Repositório clonado"

  if [ ! -f "$REPO_DIR/.env" ]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
    log ".env criado a partir do .env.example — configure antes de continuar"
  fi

  log "Instalando dependências..."
  cd "$DASHBOARD_DIR" && npm install
  log "Dependências instaladas"

  log "Executando build inicial..."
  cd "$DASHBOARD_DIR"
  node --env-file=../.env ./node_modules/.bin/next build --turbopack 2>&1 | tee -a "$LOG_FILE"
  log "Build concluído"

  service_start
  exit 0
fi

# — Auto-deploy: verifica mudanças
cd "$REPO_DIR"
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Sem mudanças."
  exit 0
fi

log "Nova versão detectada: $LOCAL -> $REMOTE"

git pull origin main --quiet
log "Pull concluído"

cd "$DASHBOARD_DIR"
node --env-file=../.env ./node_modules/.bin/next build --turbopack 2>&1 | tee -a "$LOG_FILE"
log "Build concluído"

service_start
