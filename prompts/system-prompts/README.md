# System Prompts

Prompts carregados automaticamente pelas sessoes de agentes via `--append-system-prompt`.

## Arquivos

| Arquivo | Usado por | Descricao |
|---------|-----------|-----------|
| `chat-telegram.md` | `scripts/telegram-bridge.sh` | System prompt da sessao Telegram — define formatacao, tools disponiveis, quando delegar vs agir |

## Como funciona

O `telegram-bridge.sh` carrega o prompt na inicializacao da sessao tmux:

```bash
local tg_prompt=$(cat $BRAION/prompts/system-prompts/chat-telegram.md 2>/dev/null || echo "fallback...")
claude --append-system-prompt "$tg_prompt"
```

## Editando

- Alteracoes so entram em efeito apos `/reset` no Telegram (recria a sessao)
- Mantenha os prompts concisos — cada token e multiplicado por todas as interacoes da sessao
- Arquivos `.md` nesta pasta sao gitignored (contem referencias a tools e paths pessoais). Apenas este README e versionado
