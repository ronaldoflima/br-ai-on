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

_kb_agent_collection() {
  local agent="$1"
  local config_file="$_KB_BRAION/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && config_file="$HOME/.config/br-ai-on/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && return
  local col
  col=$(KB_CONFIG_FILE="$config_file" python3 -c "
import yaml, os
try:
    with open(os.environ['KB_CONFIG_FILE']) as f:
        cfg = yaml.safe_load(f)
    v = cfg.get('knowledge_collection', '')
    if v: print(v)
except:
    pass
" 2>/dev/null)
  [ -n "$col" ] && echo "$col"
}

_kb_agent_domains() {
  local agent="$1"
  local config_file="$_KB_BRAION/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && config_file="$HOME/.config/br-ai-on/agents/$agent/config.yaml"
  [ ! -f "$config_file" ] && echo "[]" && return
  local domains
  domains=$(KB_CONFIG_FILE="$config_file" python3 -c "
import yaml, json, os
try:
    with open(os.environ['KB_CONFIG_FILE']) as f:
        cfg = yaml.safe_load(f)
    print(json.dumps(cfg.get('domain', [])))
except:
    print('[]')
" 2>/dev/null)
  echo "${domains:-[]}"
}

knowledge_publish() {
  local agent="$1" type="$2" text="$3"
  shift 3 2>/dev/null || { echo "ERROR: uso: knowledge_publish <agent> <type> <text> [--domain d1,d2] [--collection X]" >&2; return 1; }

  local domain_csv="" collection=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain_csv="${2:-}"; shift 2 ;;
      --collection) collection="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local domains
  if [ -n "$domain_csv" ]; then
    domains=$(echo "$domain_csv" | python3 -c "import json,sys; print(json.dumps([d.strip() for d in sys.stdin.read().split(',') if d.strip()]))")
  else
    domains=$(_kb_agent_domains "$agent")
  fi

  [ -z "$collection" ] && collection=$(_kb_agent_collection "$agent")

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(KB_TEXT="$text" KB_AGENT="$agent" KB_DOMAINS="$domains" KB_TYPE="$type" KB_COLLECTION="${collection:-}" python3 -c "
import json, os
d = {
    'text': os.environ['KB_TEXT'],
    'agent': os.environ['KB_AGENT'],
    'domain': json.loads(os.environ['KB_DOMAINS']),
    'type': os.environ['KB_TYPE'],
    'source': 'agent-session'
}
if os.environ.get('KB_COLLECTION'): d['collection'] = os.environ['KB_COLLECTION']
print(json.dumps(d))
")

  local response
  response=$(curl -s -X POST "$base_url/api/knowledge/entries" \
    -H "Content-Type: application/json" \
    -d "$payload")

  echo "$response"
}

knowledge_search() {
  local query="$1"
  shift 2>/dev/null || { echo "ERROR: uso: knowledge_search <query> [--agent X] [--domain X] [--type X] [--limit N] [--collection X]" >&2; return 1; }

  local agent="" domain="" type="" limit="10" collection=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      --collection) collection="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)

  local payload
  payload=$(KB_QUERY="$query" KB_LIMIT="$limit" KB_AGENT="$agent" KB_DOMAIN="$domain" KB_TYPE="$type" KB_COLLECTION="$collection" python3 -c "
import json, os
d = {'query': os.environ['KB_QUERY'], 'limit': int(os.environ['KB_LIMIT'])}
if os.environ.get('KB_AGENT'): d['agent'] = os.environ['KB_AGENT']
if os.environ.get('KB_DOMAIN'): d['domain'] = os.environ['KB_DOMAIN']
if os.environ.get('KB_TYPE'): d['type'] = os.environ['KB_TYPE']
if os.environ.get('KB_COLLECTION'): d['collection'] = os.environ['KB_COLLECTION']
print(json.dumps(d))
")

  curl -s -X POST "$base_url/api/knowledge/search" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

knowledge_list() {
  local agent="" domain="" type="" limit="20" collection=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      --domain) domain="${2:-}"; shift 2 ;;
      --type) type="${2:-}"; shift 2 ;;
      --limit) limit="${2:-}"; shift 2 ;;
      --collection) collection="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done

  local base_url
  base_url=$(_kb_dashboard_url)
  local params="limit=$limit"
  [ -n "$agent" ] && params="$params&agent=$agent"
  [ -n "$domain" ] && params="$params&domain=$domain"
  [ -n "$type" ] && params="$params&type=$type"
  [ -n "$collection" ] && params="$params&collection=$collection"

  curl -s "$base_url/api/knowledge/entries?$params"
}

# ── Modo direto ──────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail

  _kb_usage() {
    cat <<'EOF'
lib/knowledge.sh — Cliente da Knowledge Base API

Uso:
  bash lib/knowledge.sh publish <agent> <type> "texto" [--domain d1,d2] [--collection X]
  bash lib/knowledge.sh search "query" [--agent X] [--domain X] [--type X] [--limit N] [--collection X]
  bash lib/knowledge.sh list [--agent X] [--domain X] [--type X] [--limit N] [--collection X]

Tipos: insight, decision, fact, procedure
Collection: se nao informada, usa knowledge_collection do config.yaml do agente ou default
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
