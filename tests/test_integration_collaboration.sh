#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Integration: orchestrator fan-out/fan-in ==="

# 1. Create job
output=$(bash "$PROJECT_ROOT/lib/job.sh" create orchestrator "Integration test" "analista-kpi-company-v2,px-growth-agent")
job_id=$(echo "$output" | head -1)
thread_id=$(echo "$output" | tail -1)
echo "Created: $job_id ($thread_id)"

# 2. Send handoffs with job_id
ho1=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator analista-kpi-company-v2 action null \
  "Test sub-task 1" "Test context" "Test expected" "$thread_id" "$job_id")
ho2=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator px-growth-agent action null \
  "Test sub-task 2" "Test context" "Test expected" "$thread_id" "$job_id")

assert_eq "handoff 1 created" "true" "$([ -f "$ho1" ] && echo true || echo false)"
assert_eq "handoff 2 created" "true" "$([ -f "$ho2" ] && echo true || echo false)"
assert_eq "handoff 1 has job_id" "$job_id" "$(grep '^job_id:' "$ho1" | awk '{print $2}')"
assert_eq "handoff 2 has job_id" "$job_id" "$(grep '^job_id:' "$ho2" | awk '{print $2}')"
assert_eq "handoff 1 has thread_id" "$thread_id" "$(grep '^thread_id:' "$ho1" | awk '{print $2}')"

# 3. Simulate agent completion
bash "$PROJECT_ROOT/lib/job.sh" complete "$job_id" "analista-kpi-company-v2"
status1=$(bash "$PROJECT_ROOT/lib/job.sh" status "$job_id" | jq -r '.status')
assert_eq "after 1 complete: in_progress" "in_progress" "$status1"

bash "$PROJECT_ROOT/lib/job.sh" complete "$job_id" "px-growth-agent"
status2=$(bash "$PROJECT_ROOT/lib/job.sh" status "$job_id" | jq -r '.status')
assert_eq "after 2 complete: completed" "completed" "$status2"

# 4. job-agent extracts job_id from handoff
extracted=$(bash "$PROJECT_ROOT/lib/handoff.sh" job-agent "$ho1")
assert_eq "job-agent extracts job_id" "$job_id" "$extracted"

# 5. Archive job
bash "$PROJECT_ROOT/lib/job.sh" archive "$job_id"
assert_eq "job archived" "true" "$([ -f "$PROJECT_ROOT/agents/shared/jobs/archive/${job_id}.json" ] && echo true || echo false)"

# 6. Cleanup test handoffs
rm -f "$ho1" "$ho2"
rm -f "$PROJECT_ROOT/agents/shared/jobs/archive/${job_id}.json"
# Clean any other test jobs
for f in "$PROJECT_ROOT/agents/shared/jobs"/JOB-*.json; do
  [ -f "$f" ] || continue
  desc=$(jq -r '.description' "$f" 2>/dev/null || echo "")
  [ "$desc" = "Integration test" ] && rm -f "$f"
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
