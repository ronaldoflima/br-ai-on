#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d)
PASS=0; FAIL=0

cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT

export BRAION_STATE_BACKEND=file
export BRAION="$TEST_DIR"
export AGENTS_DIR="$TEST_DIR/agents"
export BRAION_AGENTS_DIR="$TEST_DIR/agents"
mkdir -p "$AGENTS_DIR/shared"
mkdir -p "$TEST_DIR/lib"
ln -sf "$PROJECT_ROOT/lib/state.py" "$TEST_DIR/lib/state.py"
ln -sf "$PROJECT_ROOT/lib/cli.sh" "$TEST_DIR/lib/cli.sh"
mkdir -p "$AGENTS_DIR/test-agent"
cat > "$AGENTS_DIR/test-agent/config.yaml" <<'YAML'
name: test-agent
domain: test
schedule:
  mode: alive
  interval: "24h"
YAML

mkdir -p "$AGENTS_DIR/handoff-agent"
cat > "$AGENTS_DIR/handoff-agent/config.yaml" <<'YAML'
name: handoff-agent
domain: test
schedule:
  mode: handoff-only
YAML

mkdir -p "$AGENTS_DIR/disabled-agent"
cat > "$AGENTS_DIR/disabled-agent/config.yaml" <<'YAML'
name: disabled-agent
domain: test
schedule:
  mode: disabled
YAML

SCHEDULER="$PROJECT_ROOT/lib/agent-scheduler.py"

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

echo "--- Test 1: force-run marks agent ---"
output=$(python3 "$SCHEDULER" --force-run test-agent)
forced=$(echo "$output" | jq -r '.forced[0]')
assert_eq "force-run returns agent name" "test-agent" "$forced"

pending=$(echo "$output" | jq -r '.pending | length')
assert_eq "pending list has 1 entry" "1" "$pending"

echo "--- Test 2: force-run shows in status ---"
status=$(python3 "$SCHEDULER")
forced_count=$(echo "$status" | jq '.summary.forced')
assert_eq "status shows 1 forced" "1" "$forced_count"

forced_list=$(echo "$status" | jq -r '.forced_agents[0]')
assert_eq "forced_agents contains test-agent" "test-agent" "$forced_list"

echo "--- Test 3: forced agent appears in due ---"
due_names=$(echo "$status" | jq -r '[.due[].name] | join(",")')
echo "$due_names" | grep -q "test-agent"
assert_eq "test-agent is in due list" "0" "$?"

echo "--- Test 4: forced agent has forced=true flag ---"
forced_flag=$(echo "$status" | jq -r '.due[] | select(.name=="test-agent") | .forced')
assert_eq "forced flag is true" "true" "$forced_flag"

echo "--- Test 5: clear-force removes marker ---"
python3 "$SCHEDULER" --clear-force test-agent > /dev/null
status2=$(python3 "$SCHEDULER")
forced_count2=$(echo "$status2" | jq '.summary.forced')
assert_eq "no forced after clear" "0" "$forced_count2"

echo "--- Test 6: force-run on handoff-only agent ---"
python3 "$SCHEDULER" --force-run handoff-agent > /dev/null
status3=$(python3 "$SCHEDULER")
due_ho=$(echo "$status3" | jq -r '[.due[].name] | join(",")')
echo "$due_ho" | grep -q "handoff-agent"
assert_eq "handoff-agent forced into due" "0" "$?"

ho_mode=$(echo "$status3" | jq -r '.due[] | select(.name=="handoff-agent") | .mode')
assert_eq "mode preserved as handoff-only" "handoff-only" "$ho_mode"
python3 "$SCHEDULER" --clear-force handoff-agent > /dev/null

echo "--- Test 7: force-run on nonexistent agent ---"
output_err=$(python3 "$SCHEDULER" --force-run nonexistent-agent)
err_msg=$(echo "$output_err" | jq -r '.errors[0]')
assert_eq "error for nonexistent agent" "config não encontrado para: nonexistent-agent" "$err_msg"

echo "--- Test 8: idempotent force-run ---"
python3 "$SCHEDULER" --force-run test-agent > /dev/null
output_dup=$(python3 "$SCHEDULER" --force-run test-agent)
pending_dup=$(echo "$output_dup" | jq '.pending | length')
assert_eq "duplicate force-run still 1 entry" "1" "$pending_dup"
python3 "$SCHEDULER" --clear-force test-agent > /dev/null

echo "--- Test 9: force-run respects budget ---"
mkdir -p "$AGENTS_DIR/budget-agent"
cat > "$AGENTS_DIR/budget-agent/config.yaml" <<'YAML'
name: budget-agent
domain: test
schedule:
  mode: alive
  interval: "24h"
budget:
  max_sessions_per_day: 0
YAML
python3 "$SCHEDULER" --force-run budget-agent > /dev/null
status4=$(python3 "$SCHEDULER")
blocked=$(echo "$status4" | jq -r '[.budget_blocked[].name] | join(",")')
echo "$blocked" | grep -q "budget-agent"
assert_eq "budget-exhausted forced agent goes to budget_blocked" "0" "$?"
python3 "$SCHEDULER" --clear-force budget-agent > /dev/null

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
