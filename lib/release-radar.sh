#!/usr/bin/env bash
set -euo pipefail

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

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    classify) cmd_classify "$@";;
    diff) cmd_diff "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
