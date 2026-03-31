#!/usr/bin/env bash
set -euo pipefail

AGENT_NAME="${1:?Uso: validate_output.sh <agent_name> <output_file>}"
OUTPUT_FILE="${2:?}"
AGENTS_DIR="${AGENTS_DIR:-agents}"

if [[ ! -f "$OUTPUT_FILE" ]]; then
  echo "FAIL: output file not found: $OUTPUT_FILE" >&2
  exit 2
fi

file_size=$(wc -c < "$OUTPUT_FILE")
if [[ $file_size -lt 10 ]]; then
  echo "FAIL: output too small (${file_size} bytes) — likely empty or incomplete" >&2
  exit 2
fi

if [[ "$OUTPUT_FILE" == *.yaml || "$OUTPUT_FILE" == *.yml ]]; then
  if command -v yq &>/dev/null; then
    if ! yq eval '.' "$OUTPUT_FILE" >/dev/null 2>&1; then
      echo "FAIL: invalid YAML in $OUTPUT_FILE" >&2
      exit 2
    fi
  fi
fi

if [[ "$OUTPUT_FILE" == *.json || "$OUTPUT_FILE" == *.jsonl ]]; then
  if ! jq '.' "$OUTPUT_FILE" >/dev/null 2>&1; then
    echo "FAIL: invalid JSON in $OUTPUT_FILE" >&2
    exit 2
  fi
fi

agent_dir="$AGENTS_DIR/$AGENT_NAME"
if [[ -d "$agent_dir" ]]; then
  owner_match=$(echo "$OUTPUT_FILE" | grep -c "$agent_dir" || true)
  shared_match=$(echo "$OUTPUT_FILE" | grep -c "shared/" || true)

  if [[ $owner_match -eq 0 && $shared_match -eq 0 ]]; then
    echo "WARN: agent $AGENT_NAME writing outside its own directory and shared/" >&2
  fi
fi

echo "PASS"
exit 0
