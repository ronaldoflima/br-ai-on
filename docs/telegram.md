# Integração com Telegram

O BR.AI.ON possui uma bridge Telegram que permite enviar mensagens ao Claude Code e receber respostas diretamente no Telegram. Funciona via **long-polling** — sem necessidade de domínio público ou SSL.

## Como funciona

```
Telegram ──► telegram-bridge.sh ──► sessão tmux (Claude Code)
                                            │
                     ◄─────────── telegram-hook.sh (Stop hook)
```

- `scripts/telegram-bridge.sh` — loop de long-polling que recebe mensagens e as envia para uma sessão tmux do Claude Code
- `scripts/telegram-hook.sh` — Stop hook registrado no Claude Code que captura a resposta final e a envia ao Telegram

## Setup

### 1. Criar um bot no Telegram

1. Abra o Telegram e inicie uma conversa com [@BotFather](https://t.me/BotFather)
2. Envie `/newbot` e siga as instruções
3. Anote o **token** retornado (formato: `123456789:AAF...`)

### 2. Obter seu Chat ID

1. Inicie uma conversa com seu bot
2. Acesse a URL no navegador (substitua `<TOKEN>`):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Envie qualquer mensagem ao bot e acesse a URL novamente
4. Localize o campo `"chat": {"id": ...}` no JSON retornado — esse é seu Chat ID

### 3. Configurar as variáveis de ambiente

Adicione ao `.env` na raiz do projeto:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_ALLOWED_CHAT_ID=987654321
```

> `TELEGRAM_ALLOWED_CHAT_ID` é opcional mas recomendado — restringe o acesso ao seu chat ID pessoal. Sem ele, qualquer pessoa pode interagir com o bot.

### 4. Registrar o Stop hook

O hook `telegram-hook.sh` precisa estar registrado no Claude Code para entregar respostas ao Telegram:

```bash
bash scripts/setup-cron.sh
```

Isso registra o `telegram-hook.sh` em `~/.claude/settings.json` como Stop hook (executado automaticamente após cada resposta do Claude).

### 5. Iniciar a bridge

```bash
bash scripts/telegram-bridge.sh
```

Para rodar em background persistente via tmux:

```bash
tmux new-session -d -s braion-telegram-bridge "bash ~/br-ai-on/scripts/telegram-bridge.sh"
```

Para ver os logs ao vivo:

```bash
tail -f ~/br-ai-on/logs/telegram-bridge.log
```

## Comandos disponíveis no Telegram

| Comando | Descrição |
|---------|-----------|
| `/start` | Inicia a sessão e exibe boas-vindas |
| `/status` | Mostra se a sessão está ativa ou processando |
| `/clear` | Limpa o contexto do Claude (`/clear`) |
| `/reset` | Destrói e recria a sessão do Claude |
| `/pause` | Pausa os agentes (cria `.paused`) |
| `/unpause` | Retoma os agentes (remove `.paused`) |
| `/deploy` | Deploy da branch `main` em produção |
| `/deploy <branch>` | Deploy de uma branch específica |
| qualquer texto | Enviado diretamente ao Claude Code |

## Variáveis de ambiente opcionais

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DEFAULT_MODEL` | `claude-sonnet-4-6` | Modelo Claude usado na sessão |
| `TELEGRAM_BOT_TOKEN` | — | Token do bot (obrigatório) |
| `TELEGRAM_ALLOWED_CHAT_ID` | — | Chat ID autorizado (recomendado) |

## Logs

```bash
tail -f logs/telegram-bridge.log
```

Formato: `[2026-01-01T00:00:00Z] START braion-telegram`
