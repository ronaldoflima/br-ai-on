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
green_out=$(echo '[{"repo":"x/y","number":1,"reason":"no_action","approved":false,"stale_hours":0,"ci":"passing"}]' | bash "$RR" classify)
assert_eq "reason desconhecido => green" "green" "$(echo "$green_out" | jq -r '.[0].severity')"

# --- diff ---
echo "--- Test: diff ---"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/snapshot.json" <<'EOF'
{"items":[
  {"repo":"px-center/px-motor","number":91,"severity":"yellow","ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"severity":"yellow","ci":"passing"}
]}
EOF
current='[
  {"repo":"px-center/px-motor","number":91,"severity":"yellow","ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"severity":"red","ci":"failing"},
  {"repo":"px-center/px-novo","number":5,"severity":"yellow","ci":"passing"}
]'
changes=$(echo "$current" | bash "$RR" diff "$TMP/snapshot.json")
assert_eq "diff retorna 2 mudancas" "2" "$(echo "$changes" | jq 'length')"
assert_eq "diff inclui PR novo"     "true" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-novo")')"
assert_eq "diff inclui sev mudada"  "true" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-cortex")')"
assert_eq "diff exclui inalterado"  "false" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-motor")')"
changes_first=$(echo "$current" | bash "$RR" diff "$TMP/inexistente.json")
assert_eq "sem snapshot => tudo muda" "3" "$(echo "$changes_first" | jq 'length')"

# --- format ---
echo "--- Test: format ---"
changes_fmt='[
  {"repo":"px-center/px-torre-core","branch":"main","number":null,"reason":"ci_red_main","severity":"red","commit":"a1b2c3","title":"fix conciliation","age_days":0},
  {"repo":"px-center/px-cortex","number":91,"reason":"your_pr_stuck","severity":"yellow","title":"refactor","age_days":1,"author":"me"},
  {"repo":"px-center/px-motor","number":482,"reason":"review_requested","severity":"yellow","title":"retry webhook","age_days":2,"author":"maria"}
]'
text=$(echo "$changes_fmt" | bash "$RR" format --date "08/06 09:00")
assert_eq "tem cabecalho"        "true" "$(echo "$text" | grep -q 'Release Radar — 08/06 09:00' && echo true || echo false)"
assert_eq "conta 1 critico"      "true" "$(echo "$text" | grep -q '🔴 1 crítico' && echo true || echo false)"
assert_eq "conta 2 amarelos"     "true" "$(echo "$text" | grep -q '🟡 2 precisam de você' && echo true || echo false)"
assert_eq "cita repo critico"    "true" "$(echo "$text" | grep -q 'px-torre-core' && echo true || echo false)"
assert_eq "cita PR review"       "true" "$(echo "$text" | grep -q '#482' && echo true || echo false)"
empty=$(echo '[]' | bash "$RR" format --date "08/06 09:00")
assert_eq "vazio => silencio" "" "$empty"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
