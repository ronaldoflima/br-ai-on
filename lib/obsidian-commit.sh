#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/../.claude/commands/tasks/tasks-config.json"

VAULT_PATH=$(jq -r '.obsidian.vault_path // empty' "$CONFIG" 2>/dev/null)
[ -z "$VAULT_PATH" ] && exit 0

VAULT_DIR="$HOME/$VAULT_PATH"
cd "$VAULT_DIR" 2>/dev/null || exit 0

git add -A
git diff --cached --quiet && exit 0
git commit -m "auto: obsidian sync $(date '+%Y-%m-%dT%H:%M:%S')"
