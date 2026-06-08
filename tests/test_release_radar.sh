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

# --- collect (com gh fake) ---
echo "--- Test: collect ---"
export GH_BIN="$PROJECT_ROOT/tests/fixtures/gh-fake.sh"
chmod +x "$GH_BIN"
collected=$(NOW="2026-06-08T09:00:00Z" bash "$RR" collect --user me --org px-center --critical-repos px-center/px-torre-core --aging-days 5)
assert_eq "collect retorna JSON array" "true" "$(echo "$collected" | jq -e 'type=="array"' >/dev/null 2>&1 && echo true || echo false)"
assert_eq "collect acha review_requested" "true" "$(echo "$collected" | jq 'any(.[]; .reason=="review_requested" and .number==482)')"
assert_eq "collect acha your_pr_stuck"    "true" "$(echo "$collected" | jq 'any(.[]; .reason=="your_pr_stuck" and .number==91)')"
assert_eq "collect acha ci_red_main"      "true" "$(echo "$collected" | jq 'any(.[]; .reason=="ci_red_main" and .repo=="px-center/px-torre-core")')"
assert_eq "review tem age_days calc"      "2"    "$(echo "$collected" | jq '[.[] | select(.number==482)][0].age_days')"

# --- enriquecimento: dados reais por PR ---
# PR 482 (review_requested): ci derivado de statusCheckRollup (SUCCESS)
assert_eq "review_requested ci=passing (real)"    "passing" "$(echo "$collected" | jq -r '[.[] | select(.number==482)][0].ci')"
assert_eq "review_requested approved=false (real)" "false"  "$(echo "$collected" | jq -r '[.[] | select(.number==482)][0].approved')"

# PR 91 (your_pr_stuck): reviewDecision=APPROVED => approved=true, stale_hours > 0
assert_eq "your_pr_stuck approved=true (real)"  "true"  "$(echo "$collected" | jq '[.[] | select(.number==91)][0].approved')"
pr91_stale=$(echo "$collected" | jq '[.[] | select(.number==91)][0].stale_hours')
assert_eq "your_pr_stuck stale_hours>0"         "true"  "$([ "$pr91_stale" -gt 0 ] && echo true || echo false)"

# PR 92 (author, nao acionavel): deve ser DESCARTADO
assert_eq "PR 92 nao-acionavel descartado"  "false" "$(echo "$collected" | jq 'any(.[]; .number==92)')"

# PR 93 (draft): deve ser DESCARTADO
assert_eq "draft PR descartado"             "false" "$(echo "$collected" | jq 'any(.[]; .number==93)')"

# team_aging: PR 700 de outro autor, antigo, em px-torre-core
assert_eq "team_aging gerado (PR 700)"      "true"  "$(echo "$collected" | jq 'any(.[]; .reason=="team_aging" and .number==700)')"
pr700_age=$(echo "$collected" | jq '[.[] | select(.number==700)][0].age_days')
assert_eq "team_aging age_days>5"           "true"  "$([ "$pr700_age" -gt 5 ] && echo true || echo false)"
assert_eq "team_aging ci=none"              "none"  "$(echo "$collected" | jq -r '[.[] | select(.number==700)][0].ci')"

# PR 91 aprovado + stale => red ao classificar com threshold 24h
classified_91=$(echo "$collected" | bash "$RR" classify --approved-stale-hours 24)
assert_eq "PR 91 aprovado+stale => red"     "red"   "$(echo "$classified_91" | jq -r '[.[] | select(.number==91)][0].severity')"
unset GH_BIN

# --- run (integracao) ---
echo "--- Test: run ---"
export GH_BIN="$PROJECT_ROOT/tests/fixtures/gh-fake.sh"
RUN_TMP=$(mktemp -d)
snap="$RUN_TMP/last_digest.json"
text1=$(RR_DRY_RUN=1 NOW="2026-06-08T09:00:00Z" bash "$RR" run \
  --user me --org px-center --critical-repos px-center/px-torre-core \
  --snapshot "$snap" --date "08/06 09:00")
assert_eq "run gera texto na 1a vez" "true" "$(echo "$text1" | grep -q 'Release Radar' && echo true || echo false)"
assert_eq "run salva snapshot"       "true" "$([ -f "$snap" ] && echo true || echo false)"
text2=$(RR_DRY_RUN=1 NOW="2026-06-08T14:00:00Z" bash "$RR" run \
  --user me --org px-center --critical-repos px-center/px-torre-core \
  --snapshot "$snap" --date "08/06 14:00")
assert_eq "run silencia sem mudancas" "" "$text2"
rm -rf "$RUN_TMP"
unset GH_BIN

# --- format backlog ---
echo "--- Test: format backlog ---"
fmt_bl='[
  {"repo":"px-center/px-a","number":1,"reason":"review_requested","severity":"yellow","title":"recente","age_days":3,"author":"x"},
  {"repo":"px-center/px-b","number":2,"reason":"review_requested","severity":"yellow","title":"antigo1","age_days":120,"author":"y"},
  {"repo":"px-center/px-c","number":3,"reason":"review_requested","severity":"yellow","title":"antigo2","age_days":140,"author":"z"}
]'
bl=$(echo "$fmt_bl" | bash "$RR" format --date "08/06 09:00" --backlog-days 60)
assert_eq "header conta todos os 3"   "true" "$(echo "$bl" | grep -q '🟡 3 precisam de você' && echo true || echo false)"
assert_eq "lista o review recente"    "true" "$(echo "$bl" | grep -q '#1' && echo true || echo false)"
assert_eq "NAO lista review antigo"   "false" "$(echo "$bl" | grep -q '#2' && echo true || echo false)"
assert_eq "tem linha de backlog"      "true" "$(echo "$bl" | grep -q '+2 reviews antigos' && echo true || echo false)"

# backlog com default 60: items antigos (age_days=120,140) devem sumir individualmente
assert_eq "backlog default: linha resumo com >60d" "true" "$(echo "$bl" | grep -q '>60d' && echo true || echo false)"

# sem --backlog-days: comportamento default igual a --backlog-days 60 (nao lista antigos)
bl_default=$(echo "$fmt_bl" | bash "$RR" format --date "08/06 09:00")
assert_eq "default backlog-days funciona" "true" "$(echo "$bl_default" | grep -q '+2 reviews antigos' && echo true || echo false)"

# reviews com age_days <= backlog_days sao listados normalmente
fmt_bl2='[
  {"repo":"px-center/px-x","number":99,"reason":"review_requested","severity":"yellow","title":"bordeline","age_days":60,"author":"a"}
]'
bl2=$(echo "$fmt_bl2" | bash "$RR" format --date "08/06 09:00" --backlog-days 60)
assert_eq "age_days==backlog_days listado normalmente" "true" "$(echo "$bl2" | grep -q '#99' && echo true || echo false)"

# quando nao ha reviews antigos, nao deve aparecer linha de backlog
fmt_bl3='[
  {"repo":"px-center/px-x","number":10,"reason":"review_requested","severity":"yellow","title":"novo","age_days":5,"author":"a"}
]'
bl3=$(echo "$fmt_bl3" | bash "$RR" format --date "08/06 09:00" --backlog-days 60)
assert_eq "sem antigos: nao aparece linha backlog" "false" "$(echo "$bl3" | grep -q 'reviews antigos' && echo true || echo false)"

# run aceita --backlog-days e repassa ao format
echo "--- Test: run --backlog-days ---"
export GH_BIN="$PROJECT_ROOT/tests/fixtures/gh-fake.sh"
RUN_TMP2=$(mktemp -d)
snap2="$RUN_TMP2/last_digest2.json"
text_bl=$(RR_DRY_RUN=1 NOW="2026-06-08T09:00:00Z" bash "$RR" run \
  --user me --org px-center --critical-repos px-center/px-torre-core \
  --snapshot "$snap2" --date "08/06 09:00" --backlog-days 1)
assert_eq "run com --backlog-days gera texto" "true" "$(echo "$text_bl" | grep -q 'Release Radar' && echo true || echo false)"
rm -rf "$RUN_TMP2"
unset GH_BIN

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
