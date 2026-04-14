#!/usr/bin/env bash
# scripts/agent-idle-hook.sh
# Hook stop-like: marca sessão braion-* como idle via flag file.
# Invocado pelo backend AI (ex: Claude Code Stop hook) ao terminar de responder.

[ -n "${TMUX:-}" ] || exit 0

session=$(tmux display-message -p '#S' 2>/dev/null || echo "")
[[ "$session" == braion-* ]] || exit 0

IDLE_DIR="${IDLE_DIR:-$HOME/.config/br-ai-on/idle}"
mkdir -p "$IDLE_DIR"
touch "$IDLE_DIR/$session"
