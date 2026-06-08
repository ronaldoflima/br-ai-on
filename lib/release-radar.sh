#!/usr/bin/env bash
set -euo pipefail

GH() { "${GH_BIN:-gh}" "$@"; }

# dias inteiros entre uma data ISO e NOW (default: agora)
_age_days() {
  local iso="$1"
  local now="${NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  local t0 t1
  t0=$(date -u -d "$iso" +%s 2>/dev/null || echo 0)
  t1=$(date -u -d "$now" +%s 2>/dev/null || echo 0)
  echo $(( (t1 - t0) / 86400 ))
}

cmd_classify() {
  local stale_h=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --approved-stale-hours)
        stale_h="${2:?--approved-stale-hours requer um valor}"
        [[ "$stale_h" =~ ^[0-9]+$ ]] || { echo "valor invalido para --approved-stale-hours: $stale_h" >&2; exit 2; }
        shift 2;;
      *) shift;;
    esac
  done
  jq --argjson stale_h "$stale_h" '
    map(. + {severity: (
      if .reason == "ci_red_main" then "red"
      elif (.reason == "your_pr_stuck" and .approved and (.stale_hours >= $stale_h)) then "red"
      elif .reason == "review_requested" then "yellow"
      elif .reason == "your_pr_stuck" then "yellow"
      elif .reason == "team_aging" then "yellow"
      else "green" end
    )})'
}

cmd_diff() {
  local snapshot="${1:-}"
  local prev='[]'
  if [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
    prev=$(jq '.items // []' "$snapshot")
  fi
  jq --argjson prev "$prev" '
    ($prev | map({key: "\(.repo)#\(.number // .branch)", value: .}) | from_entries) as $pmap
    | map(. + {_key: "\(.repo)#\(.number // .branch)"})
    | map(select(
        ($pmap[._key] == null)
        or ($pmap[._key].severity != .severity)
        or ($pmap[._key].ci != .ci)
      ))
    | map(del(._key))'
}

cmd_format() {
  local date_str=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --date) date_str="${2:-}"; shift 2;;
      *) shift;;
    esac
  done
  local items; items=$(cat)
  local n; n=$(echo "$items" | jq 'length')
  if [ "$n" = "0" ]; then return 0; fi

  local reds yellows nred nyellow
  reds=$(echo "$items" | jq '[.[] | select(.severity=="red")]')
  yellows=$(echo "$items" | jq '[.[] | select(.severity=="yellow")]')
  nred=$(echo "$reds" | jq 'length')
  nyellow=$(echo "$yellows" | jq 'length')

  printf '📡 Release Radar — %s\n' "$date_str"

  if [ "$nred" -gt 0 ]; then
    printf '\n🔴 %s crítico\n' "$nred"
    echo "$reds" | jq -r '.[] |
      if .reason == "ci_red_main"
      then "• \(.repo | sub("px-center/";"")): CI vermelho na main (\(.commit) \"\(.title)\")"
      else "• \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — aprovado e parado" end'
  fi

  if [ "$nyellow" -gt 0 ]; then
    printf '\n🟡 %s precisam de você\n' "$nyellow"
    echo "$yellows" | jq -r '.[] |
      if .reason == "review_requested" then "• [review] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d, te aguarda"
      elif .reason == "your_pr_stuck" then "• [seu PR] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — travado \(.age_days)d"
      else "• [envelhecendo] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d (\(.author))" end'
  fi

  printf '\n(silêncio nos demais repos = ok)\n'
}

cmd_collect() {
  local user="" org="px-center" critical=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2;;
      --org) org="${2:-}"; shift 2;;
      --critical-repos) critical="${2:-}"; shift 2;;
      *) shift;;
    esac
  done

  local out='[]'
  local map_pr='{repo: .repository.nameWithOwner, number: .number, branch: null, title: .title, url: .url, author: .author.login, created: .createdAt, updated: .updatedAt}'

  local rr
  rr=$(GH search prs --review-requested="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')
  rr=$(echo "$rr" | jq "map($map_pr + {reason:\"review_requested\", approved:false, ci:\"none\", mergeable:true, stale_hours:0})")

  local mine
  mine=$(GH search prs --author="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')
  mine=$(echo "$mine" | jq "map($map_pr + {reason:\"your_pr_stuck\", approved:true, ci:\"passing\", mergeable:true, stale_hours:0})")

  out=$(jq -n --argjson a "$rr" --argjson b "$mine" '$a + $b')

  local IFS=','
  local repo
  for repo in $critical; do
    [ -n "$repo" ] || continue
    local checks failed
    checks=$(GH api "repos/$repo/commits/main/check-runs" 2>/dev/null || echo '{"check_runs":[]}')
    failed=$(echo "$checks" | jq '[.check_runs[]? | select(.conclusion=="failure")] | length')
    if [ "${failed:-0}" -gt 0 ]; then
      local item
      item=$(jq -n --arg repo "$repo" '{repo:$repo, number:null, branch:"main", title:"build main", url:("https://github.com/"+$repo), author:"-", reason:"ci_red_main", approved:false, ci:"failing", mergeable:true, stale_hours:0, commit:"main", age_days:0}')
      out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    fi
  done

  echo "$out" | jq -c '.[]' | while read -r line; do
    local created age
    created=$(echo "$line" | jq -r '.created // empty')
    if [ -n "$created" ]; then
      age=$(_age_days "$created")
      echo "$line" | jq --argjson age "$age" '. + {age_days:$age}'
    else
      echo "$line"
    fi
  done | jq -s '.'
}

cmd_run() {
  local user="" org="px-center" critical="" snapshot="" date_str="" stale_h=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2;;
      --org) org="${2:-}"; shift 2;;
      --critical-repos) critical="${2:-}"; shift 2;;
      --snapshot) snapshot="${2:-}"; shift 2;;
      --date) date_str="${2:-}"; shift 2;;
      --approved-stale-hours) stale_h="${2:-}"; shift 2;;
      *) shift;;
    esac
  done

  local current
  current=$(cmd_collect --user "$user" --org "$org" --critical-repos "$critical" \
    | cmd_classify --approved-stale-hours "$stale_h")

  local changes
  changes=$(echo "$current" | cmd_diff "$snapshot")

  if [ -n "$snapshot" ]; then
    mkdir -p "$(dirname "$snapshot")"
    jq -n --argjson items "$current" --arg at "${NOW:-}" '{generated_at:$at, items:$items}' > "$snapshot"
  fi

  local text
  text=$(echo "$changes" | cmd_format --date "$date_str")
  [ -n "$text" ] || return 0

  if [ "${RR_DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$text"
  else
    bash "$(dirname "${BASH_SOURCE[0]}")/telegram.sh" send "$text"
  fi
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    collect) cmd_collect "$@";;
    classify) cmd_classify "$@";;
    diff) cmd_diff "$@";;
    format) cmd_format "$@";;
    run) cmd_run "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
