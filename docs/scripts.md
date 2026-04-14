# Scripts

Scripts de automação e setup em `scripts/`.

## Infraestrutura

### install.sh
Deploy completo em produção: clona repo, instala dependências, builda dashboard Next.js, cria serviço systemd. Usa `cli_commands_install_dir` para path de instalação de commands.

### uninstall.sh
Remove o serviço systemd do braion.

### setup-cron.sh
Configura crontab para `lib/agent-cron.sh` (a cada 5min) e registra hooks via `cli_hook_register` (antes manipulava JSON direto em `~/.claude/settings.json`).

### setup-totp.js
Gera TOTP (2FA) para o dashboard — cria secret, QR code, salva no `.env`.

## Telegram

### telegram-bridge.sh
Bridge bidirecional Telegram ↔ CLI AI ativo. Long-polling do Telegram, envia mensagens para sessão tmux. Usa `lib/telegram.sh` para envio e `lib/cli.sh` para `cli_build_start_cmd`, `cli_wait_ready`, `cli_send_clear` e `cli_prompt_glyph`. Inclui validação de divergência com `origin/main` antes de deploy.

Comandos: `/start`, `/status`, `/clear`, `/reset`, `/pause`, `/unpause`, `/deploy [branch]`.

### telegram-hook.sh
Stop hook do Claude Code — captura resposta do assistente e envia de volta ao Telegram via `lib/telegram.sh`.

## Release

### release.sh
Script de release com versionamento semântico. Bumpa `package.json` + `package-lock.json`, cria commit e tag.

```bash
./release.sh patch   # 1.3.1 → 1.3.2
./release.sh minor   # 1.3.2 → 1.4.0
./release.sh major   # 1.4.0 → 2.0.0
```

Também disponível via `npm run release` no dashboard.

## Utilitários

### create-agent.sh
Wizard interativo para criar novos agentes com estrutura completa. Usa `cli_default_model` e `cli_fallback_model` para valores padrão.

### claude-switch.sh
Fallback automático Claude → Ollama em caso de rate limit. Funções: `claude-rl`, `claude-ok`, `claude-status`, `clo`.

### agent-idle-hook.sh
Hook que marca sessões tmux como idle via flag file. Diretório configurável via env `IDLE_DIR` (padrão: `~/.config/br-ai-on/idle/`).

### hub.sh
Plugin manager para commands do CLI AI — install, uninstall, update de plugins com versionamento. Estrutura: `hub/plugins/<backend>/<plugin>/`. Manifest usa `install_dir` relativo ao `cli_commands_install_dir` do backend ativo.
