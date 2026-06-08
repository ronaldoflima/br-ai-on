#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RR="$PROJECT_ROOT/lib/release-radar.sh"
PASS=0; FAIL=0

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

# --- classify ---
echo "--- Test: classify ---"
items='[
  {"repo":"px-center/px-torre-core","branch":"main","number":null,"reason":"ci_red_main","approved":false,"stale_hours":0,"ci":"failing"},
  {"repo":"px-center/px-motor","number":91,"reason":"your_pr_stuck","approved":true,"stale_hours":30,"ci":"passing"},
  {"repo":"px-center/px-motor","number":92,"reason":"your_pr_stuck","approved":true,"stale_hours":5,"ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"reason":"review_requested","approved":false,"stale_hours":48,"ci":"passing"},
  {"repo":"px-center/px-cortex","number":11,"reason":"team_aging","approved":false,"stale_hours":200,"ci":"passing"}
]'
out=$(echo "$items" | bash "$RR" classify --approved-stale-hours 24)
assert_eq "ci_red_main => red"        "red"    "$(echo "$out" | jq -r '.[0].severity')"
assert_eq "approved+stale => red"     "red"    "$(echo "$out" | jq -r '.[1].severity')"
assert_eq "approved+fresh => yellow"  "yellow" "$(echo "$out" | jq -r '.[2].severity')"
assert_eq "review_requested => yellow" "yellow" "$(echo "$out" | jq -r '.[3].severity')"
assert_eq "team_aging => yellow"      "yellow" "$(echo "$out" | jq -r '.[4].severity')"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
