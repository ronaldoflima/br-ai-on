#!/bin/bash
set -e

REPO_URL="git@github.com:ronaldoflima/br-ai-on.git"
REPO_DIR="${REPO_DIR:-$HOME/br-ai-on}"
DASHBOARD_DIR="$REPO_DIR/dashboard"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/deploy-prod.log"
SERVICE_FILE="$HOME/.config/systemd/user/braion.service"
OS="$(uname -s)"
NODE_MIN="20"

check_deps() {
  local missing=()

  if ! command -v git &>/dev/null; then
    missing+=("git")
  fi

  if ! command -v node &>/dev/null; then
    missing+=("node")
  else
    local node_ver
    node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_ver" -lt "$NODE_MIN" ]; then
      echo "Node.js $NODE_MIN+ necessário (encontrado: $(node -v))"
      missing+=("node")
    fi
  fi

  if ! command -v npm &>/dev/null; then
    missing+=("npm")
  fi

  if [ ${#missing[@]} -eq 0 ]; then
    return 0
  fi

  echo "Dependências faltando: ${missing[*]}"
  echo "Instalando..."

  if [ "$OS" = "Linux" ]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq
      if [[ " ${missing[*]} " == *" node "* ]] || [[ " ${missing[*]} " == *" npm "* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
      fi
      if [[ " ${missing[*]} " == *" git "* ]]; then
        sudo apt-get install -y -qq git
      fi
    elif command -v dnf &>/dev/null; then
      if [[ " ${missing[*]} " == *" node "* ]] || [[ " ${missing[*]} " == *" npm "* ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo dnf install -y nodejs
      fi
      if [[ " ${missing[*]} " == *" git "* ]]; then
        sudo dnf install -y git
      fi
    else
      echo "Gerenciador de pacotes não suportado. Instale manualmente: ${missing[*]}"
      exit 1
    fi
  elif [ "$OS" = "Darwin" ]; then
    if ! command -v brew &>/dev/null; then
      echo "Instalando Homebrew..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    if [[ " ${missing[*]} " == *" node "* ]] || [[ " ${missing[*]} " == *" npm "* ]]; then
      brew install node
    fi
    if [[ " ${missing[*]} " == *" git "* ]]; then
      brew install git
    fi
  fi

  echo "Dependências instaladas."
}

check_deps

setup_commands() {
  local commands_dir="$REPO_DIR/commands/braion"
  local target_dir="$HOME/.claude/commands/braion"

  if [ ! -d "$commands_dir" ]; then
    echo "WARN: $commands_dir não encontrado — pulando setup de commands"
    return
  fi

  mkdir -p "$HOME/.claude/commands"

  if [ -L "$target_dir" ]; then
    rm "$target_dir"
  elif [ -d "$target_dir" ]; then
    rm -rf "$target_dir"
  fi

  ln -sf "$commands_dir" "$target_dir"
  echo "Commands linkados: $target_dir -> $commands_dir"

  if [ -d "$REPO_DIR/.claude/commands/braion" ]; then
    rm -rf "$REPO_DIR/.claude/commands/braion"
    echo "Symlinks antigos removidos de .claude/commands/braion"
  fi
}

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
  log "Repositório encontrado."
else
  if [ -d "$REPO_DIR" ]; then
    BACKUP="${REPO_DIR}.bak.$(date '+%Y%m%d%H%M%S')"
    echo "Backup de $REPO_DIR em $BACKUP..."
    mv "$REPO_DIR" "$BACKUP"
  fi
  [ -d "$REPO_DIR" ] && rm -rf "$REPO_DIR"
  echo "Clonando repositório em $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR"
  git -C "$REPO_DIR" checkout main
  log "Repositório clonado"

  setup_commands

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

HAS_STASH=false
if ! git diff --quiet || ! git diff --cached --quiet; then
  git stash push -m "install-auto-$(date '+%Y%m%d%H%M%S')"
  HAS_STASH=true
  log "Mudanças locais salvas em stash"
fi

if ! git rebase origin/main 2>/dev/null; then
  git rebase --abort 2>/dev/null || true
  log "WARN: rebase falhou, usando reset para origin/main"
  git reset --hard origin/main
fi

if [ "$HAS_STASH" = true ]; then
  if git stash pop 2>/dev/null; then
    log "Mudanças locais restauradas"
  else
    log "WARN: conflito ao restaurar mudanças locais — mantidas no stash"
  fi
fi

log "Atualização concluída"

setup_commands

cd "$DASHBOARD_DIR"
node --env-file=../.env ./node_modules/.bin/next build --turbopack 2>&1 | tee -a "$LOG_FILE"
log "Build concluído"

service_start
