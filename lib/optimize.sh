#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPT_STATE="${PROJECT_DIR}/agents/optimizer/state"
PROPOSALS_DIR="${OPT_STATE}/proposals"
VERSIONS_FILE="${OPT_STATE}/prompt_versions.jsonl"
BACKUPS_DIR="${OPT_STATE}/backups"

mkdir -p "$PROPOSALS_DIR" "$BACKUPS_DIR"

version_snapshot() {
  local agent="${1:?Uso: version_snapshot <agent>}"
  local identity_file="${PROJECT_DIR}/agents/${agent}/IDENTITY.md"
  local config_file="${PROJECT_DIR}/agents/${agent}/config.yaml"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if [[ ! -f "$identity_file" ]]; then
    echo "IDENTITY.md não encontrado para $agent"
    return 1
  fi

  local version
  version=$(grep '^version:' "$config_file" 2>/dev/null | sed 's/version: *"\(.*\)"/\1/' || echo "unknown")

  local soul_hash
  soul_hash=$(md5sum "$identity_file" 2>/dev/null | cut -d' ' -f1 || md5 -q "$identity_file" 2>/dev/null || echo "unknown")
  local soul_tokens
  soul_tokens=$(wc -w < "$identity_file" | tr -d ' ')

  cp "$identity_file" "${BACKUPS_DIR}/${agent}_soul_${version}.md"
  [[ -f "$config_file" ]] && cp "$config_file" "${BACKUPS_DIR}/${agent}_config_${version}.yaml"

  jq -nc \
    --arg ts "$timestamp" \
    --arg agent "$agent" \
    --arg version "$version" \
    --arg hash "$soul_hash" \
    --argjson tokens "$soul_tokens" \
    '{timestamp:$ts,agent:$agent,version:$version,soul_hash:$hash,soul_tokens:$tokens,action:"snapshot"}' \
    >> "$VERSIONS_FILE"

  echo "[$agent] Snapshot v${version}: ${soul_tokens} tokens, hash=${soul_hash:0:8}"
}

create_proposal() {
  local agent="${1:?Uso: create_proposal <agent> <problem> <suggestion>}"
  local problem="${2:?}"
  local suggestion="${3:?}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local date_str
  date_str=$(date -u +"%Y%m%d_%H%M%S")
  local proposal_file="${PROPOSALS_DIR}/${agent}_${date_str}.md"

  cat > "$proposal_file" << EOF
# Proposta de Otimização — ${agent}

**Data**: ${timestamp}
**Status**: pendente

## Problema Detectado

${problem}

## Mudança Sugerida

${suggestion}

## Impacto Esperado

A ser preenchido após análise.

## Decisão

- [ ] Aprovado
- [ ] Rejeitado
- [ ] Precisa mais dados
EOF

  echo "Proposta criada: $proposal_file"
}

list_proposals() {
  local status="${1:-all}"

  if [[ ! -d "$PROPOSALS_DIR" ]] || [[ -z "$(ls -A "$PROPOSALS_DIR" 2>/dev/null)" ]]; then
    echo "Nenhuma proposta encontrada."
    return 0
  fi

  for f in "$PROPOSALS_DIR"/*.md; do
    local fname
    fname=$(basename "$f")
    local pstatus
    pstatus=$(grep '^\*\*Status\*\*:' "$f" | sed 's/.*: //' | tr -d '\r')
    if [[ "$status" == "all" ]] || [[ "$pstatus" == *"$status"* ]]; then
      echo "- $fname ($pstatus)"
    fi
  done
}

version_history() {
  local agent="${1:-}"

  if [[ ! -f "$VERSIONS_FILE" ]]; then
    echo "Sem histórico de versões."
    return 0
  fi

  if [[ -n "$agent" ]]; then
    jq -r --arg agent "$agent" 'select(.agent == $agent) | "\(.timestamp) | \(.agent) v\(.version) | \(.soul_tokens) tokens | \(.action)"' "$VERSIONS_FILE"
  else
    jq -r '"\(.timestamp) | \(.agent) v\(.version) | \(.soul_tokens) tokens | \(.action)"' "$VERSIONS_FILE"
  fi
}

rollback() {
  local agent="${1:?Uso: rollback <agent> <version>}"
  local version="${2:?}"
  local backup_soul="${BACKUPS_DIR}/${agent}_soul_${version}.md"
  local backup_config="${BACKUPS_DIR}/${agent}_config_${version}.yaml"

  if [[ ! -f "$backup_soul" ]]; then
    echo "Backup não encontrado: $backup_soul"
    return 1
  fi

  version_snapshot "$agent"

  cp "$backup_soul" "${PROJECT_DIR}/agents/${agent}/IDENTITY.md"
  [[ -f "$backup_config" ]] && cp "$backup_config" "${PROJECT_DIR}/agents/${agent}/config.yaml"

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  jq -nc \
    --arg ts "$timestamp" \
    --arg agent "$agent" \
    --arg version "$version" \
    '{timestamp:$ts,agent:$agent,version:$version,action:"rollback"}' \
    >> "$VERSIONS_FILE"

  echo "[$agent] Rollback para v${version} concluído"
}

audit_prompt_sizes() {
  local max_tokens="${1:-2000}"
  local output="<b>📏 Audit de Tamanho dos Prompts</b>\n\n"
  local has_bloat=false

  for identity_file in "${PROJECT_DIR}/agents"/*/IDENTITY.md; do
    local agent
    agent=$(basename "$(dirname "$identity_file")")
    local identity_file="${PROJECT_DIR}/agents/${agent}/IDENTITY.md"
    if [[ -f "$identity_file" ]]; then
      local word_count
      word_count=$(wc -w < "$identity_file" | tr -d ' ')
      local icon="✅"
      if [[ "$word_count" -gt "$max_tokens" ]]; then
        icon="⚠️"
        has_bloat=true
      fi
      output+="${icon} <b>${agent}</b>: ${word_count} words\n"
    fi
  done

  if [[ "$has_bloat" == true ]]; then
    output+="\n⚠️ Agentes acima de ${max_tokens} words precisam de simplificação."
  else
    output+="\n✅ Todos os prompts dentro do limite."
  fi

  echo -e "$output"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-help}"
  shift || true
  case "$cmd" in
    snapshot) version_snapshot "$@" ;;
    propose) create_proposal "$@" ;;
    list) list_proposals "$@" ;;
    history) version_history "$@" ;;
    rollback) rollback "$@" ;;
    audit) audit_prompt_sizes "$@" ;;
    *) echo "Uso: optimize.sh {snapshot|propose|list|history|rollback|audit} [args...]" ;;
  esac
fi