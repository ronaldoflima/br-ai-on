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

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    classify) cmd_classify "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
