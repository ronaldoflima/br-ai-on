# Scripts

Scripts de automação e setup em `scripts/`.

## Infraestrutura

### install.sh
Deploy completo em produção: clona repo, instala dependências, builda dashboard Next.js, cria serviço systemd.

### uninstall.sh
Remove o serviço systemd do braion.

### setup-cron.sh
Configura crontab para `lib/agent-cron.sh` (a cada 5min) e registra hooks do Claude Code (idle, telegram).

### setup-totp.js
Gera TOTP (2FA) para o dashboard — cria secret, QR code, salva no `.env`.

## Telegram

### telegram-bridge.sh
Bridge bidirecional Telegram ↔ Claude Code. Long-polling do Telegram, envia mensagens para sessão tmux do Claude.

Comandos: `/start`, `/status`, `/clear`, `/reset`, `/pause`, `/unpause`, `/deploy [branch]`.

### telegram-hook.sh
Stop hook do Claude Code — captura resposta do assistente e envia de volta ao Telegram (chunks de 4096 chars).

## Utilitários

### create-agent.sh
Wizard interativo para criar novos agentes com estrutura completa.

### claude-switch.sh
Fallback automático Claude → Ollama em caso de rate limit. Funções: `claude-rl`, `claude-ok`, `claude-status`, `clo`.

### agent-idle-hook.sh
Hook que marca sessões tmux como idle via flag file em `~/.config/br-ai-on/idle/`.

### hub.sh
Plugin manager para commands do Claude Code — install, uninstall, update de plugins com versionamento.
