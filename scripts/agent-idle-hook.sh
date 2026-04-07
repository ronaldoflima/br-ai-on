#!/usr/bin/env bash
# scripts/agent-idle-hook.sh
# Hook Stop: marca sessão braion-* como idle via flag file
# Executado pelo Claude Code ao terminar de responder

[ -n "${TMUX:-}" ] || exit 0

session=$(tmux display-message -p '#S' 2>/dev/null || echo "")
[[ "$session" == braion-* ]] || exit 0

mkdir -p "$HOME/.config/br-ai-on/idle"
touch "$HOME/.config/br-ai-on/idle/$session"
