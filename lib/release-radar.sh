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

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    classify) cmd_classify "$@";;
    diff) cmd_diff "$@";;
    format) cmd_format "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
