#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAION="${BRAION:-$(dirname "$SCRIPT_DIR")}"

migrated=0
skipped=0

for agent_dir in "$BRAION"/agents/*/state; do
  [ -d "$agent_dir" ] || continue
  agent=$(basename "$(dirname "$agent_dir")")
  [ "$agent" = "_defaults" ] && continue
  [ "$agent" = "shared" ] && continue

  for file in current_objective decisions completed_tasks; do
    src="$agent_dir/${file}.md"
    [ -f "$src" ] || continue
    dest_dir="$agent_dir/$file"

    if [ -d "$dest_dir" ]; then
      echo "SKIP $agent/$file — diretório já existe"
      skipped=$((skipped + 1))
      continue
    fi

    mkdir -p "$dest_dir"
    today=$(date -u +%Y-%m-%d)
    mv "$src" "$dest_dir/${today}.md"
    echo "OK   $agent/$file.md → $file/${today}.md"
    migrated=$((migrated + 1))
  done
done

echo ""
echo "Migração concluída: $migrated arquivo(s) migrado(s), $skipped ignorado(s)."
