#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/cli.sh"

# Resolve config do plugin tasks. Procura primeiro no repo (.claude/commands legado),
# depois no diretório de instalação do backend atual.
_candidates=(
  "$SCRIPT_DIR/../.claude/commands/tasks/tasks-config.json"
  "$(cli_commands_install_dir)/tasks/tasks-config.json"
)
CONFIG=""
for c in "${_candidates[@]}"; do
  [ -f "$c" ] && { CONFIG="$c"; break; }
done
[ -z "$CONFIG" ] && exit 0

VAULT_PATH=$(jq -r '.obsidian.vault_path // empty' "$CONFIG" 2>/dev/null)
[ -z "$VAULT_PATH" ] && exit 0

VAULT_DIR="$HOME/$VAULT_PATH"
cd "$VAULT_DIR" 2>/dev/null || exit 0

git add -A
git diff --cached --quiet && exit 0
git commit -m "auto: obsidian sync $(date '+%Y-%m-%dT%H:%M:%S')"
