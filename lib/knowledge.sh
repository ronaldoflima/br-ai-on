#!/usr/bin/env bash
# lib/knowledge.sh — Thin client para Knowledge Base API
#
# Uso como biblioteca (source):
#   source "$(dirname "$0")/../lib/knowledge.sh"
#   knowledge_publish "agent-name" "insight" "texto do knowledge" --domain "netsuite,billing"
#   knowledge_search "query" --agent "agent-name" --domain "netsuite"
#
# Uso direto:
#   bash lib/knowledge.sh publish <agent> <type> "texto" [--domain d1,d2]
#   bash lib/knowledge.sh search "query" [--agent X] [--domain X] [--type X] [--limit N]
#   bash lib/knowledge.sh list [--agent X] [--domain X] [--type X] [--limit N]

_KB_BRAION="${_KB_BRAION:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"

_kb_dashboard_url() {
  local config_file="$_KB_BRAION/config/knowledge.yaml"
  if [ -f "$config_file" ]; then
    local url
    url=$(grep '^dashboard_url:' "$config_file" | sed 's/^dashboard_url: *//' | tr -d '"' | tr -d "'")
    [ -n "$url" ] && echo "$url" && return
  fi
  echo "http://localhost:3040"
}

_kb_agent_domains() {
  local agent="$1"
  local config_file="$_KB_BRAION/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && config_file="$HOME/.config/br-ai-on/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && echo "[]" && return
  local domains
  domains=$(python3 -c "
import yaml, json, sys
try:
    with open('$config_file') as f:
        cfg = yaml.safe_load(f)
    print(json.dumps(cfg.get('domain', [])))
except:
    print('[]')
" 2>/dev/null)
  echo "${domains:-[]}"
}

knowledge_publish() {
  local agent="$1" type="$2" text="$3"
  shift 3 2>/dev/null || { echo "ERROR: uso: knowledge_publish <agent> <type> <text> [--domain d1,d2]" >&2; return 1; }

  local domain_csv=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain_csv="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local domains
  if [ -n "$domain_csv" ]; then
    domains=$(echo "$domain_csv" | python3 -c "import json,sys; print(json.dumps([d.strip() for d in sys.stdin.read().split(',') if d.strip()]))")
  else
    domains=$(_kb_agent_domains "$agent")
  fi

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({
    'text': '''$text''',
    'agent': '$agent',
    'domain': json.loads('$domains'),
    'type': '$type',
    'source': 'agent-session'
}))
")

  local response
  response=$(curl -s -X POST "$base_url/api/knowledge/entries" \
    -H "Content-Type: application/json" \
    -d "$payload")

  echo "$response"
}

knowledge_search() {
  local query="$1"
  shift 2>/dev/null || { echo "ERROR: uso: knowledge_search <query> [--agent X] [--domain X] [--type X] [--limit N]" >&2; return 1; }

  local agent="" domain="" type="" limit="10"
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(python3 -c "
import json
d = {'query': '''$query''', 'limit': $limit}
if '$agent': d['agent'] = '$agent'
if '$domain': d['domain'] = '$domain'
if '$type': d['type'] = '$type'
print(json.dumps(d))
")

  curl -s -X POST "$base_url/api/knowledge/search" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

knowledge_list() {
  local agent="" domain="" type="" limit="20"
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)
  local params="limit=$limit"
  [ -n "$agent" ] && params="$params&agent=$agent"
  [ -n "$domain" ] && params="$params&domain=$domain"
  [ -n "$type" ] && params="$params&type=$type"

  curl -s "$base_url/api/knowledge/entries?$params"
}

# ── Modo direto ──────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail

  _kb_usage() {
    cat <<'EOF'
lib/knowledge.sh — Cliente da Knowledge Base API

Uso:
  bash lib/knowledge.sh publish <agent> <type> "texto" [--domain d1,d2]
  bash lib/knowledge.sh search "query" [--agent X] [--domain X] [--type X] [--limit N]
  bash lib/knowledge.sh list [--agent X] [--domain X] [--type X] [--limit N]

Tipos: insight, decision, fact, procedure
EOF
    exit "${1:-0}"
  }

  cmd="${1:-}"
  shift 2>/dev/null || true

  case "$cmd" in
    publish)
      agent="${1:-}"; shift 2>/dev/null || true
      type="${1:-}"; shift 2>/dev/null || true
      text="${1:-}"; shift 2>/dev/null || true
      [ -z "$agent" ] || [ -z "$type" ] || [ -z "$text" ] && {
        echo "ERROR: publish requer <agent> <type> <texto>" >&2; _kb_usage 1;
      }
      knowledge_publish "$agent" "$type" "$text" "$@"
      ;;
    search)
      query="${1:-}"; shift 2>/dev/null || true
      [ -z "$query" ] && { echo "ERROR: search requer <query>" >&2; _kb_usage 1; }
      knowledge_search "$query" "$@"
      ;;
    list)
      knowledge_list "$@"
      ;;
    help|--help|-h)
      _kb_usage 0
      ;;
    *)
      echo "ERROR: comando desconhecido '$cmd'" >&2
      _kb_usage 1
      ;;
  esac
fi
