#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_JOBS_DIR=$(mktemp -d)
PASS=0; FAIL=0

cleanup() { rm -rf "$TEST_JOBS_DIR"; }
trap cleanup EXIT

export JOBS_DIR="$TEST_JOBS_DIR"
JOB_SH="$PROJECT_ROOT/lib/job.sh"

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

# Test 1: create
echo "--- Test: create ---"
output=$(bash "$JOB_SH" create orchestrator "Test job" "agent-a,agent-b")
job_id=$(echo "$output" | head -1)
thread_id=$(echo "$output" | tail -1)
assert_eq "create returns JOB ID" "JOB-" "$(echo "$job_id" | cut -c1-4)"
assert_eq "create returns THR ID" "THR-" "$(echo "$thread_id" | cut -c1-4)"

job_file="$TEST_JOBS_DIR/${job_id}.json"
assert_eq "job file exists" "true" "$([ -f "$job_file" ] && echo true || echo false)"
assert_eq "status is pending" "pending" "$(jq -r '.status' "$job_file")"
assert_eq "expected has 2 agents" "2" "$(jq '.expected | length' "$job_file")"

# Test 2: complete one agent
echo "--- Test: complete one ---"
bash "$JOB_SH" complete "$job_id" "agent-a"
assert_eq "status is in_progress" "in_progress" "$(jq -r '.status' "$job_file")"
assert_eq "completed has 1" "1" "$(jq '.completed | length' "$job_file")"

# Test 3: complete second agent
echo "--- Test: complete all ---"
bash "$JOB_SH" complete "$job_id" "agent-b"
assert_eq "status is completed" "completed" "$(jq -r '.status' "$job_file")"
assert_eq "completed has 2" "2" "$(jq '.completed | length' "$job_file")"

# Test 4: fail
echo "--- Test: fail ---"
output2=$(bash "$JOB_SH" create orchestrator "Fail job" "agent-x,agent-y")
job_id2=$(echo "$output2" | head -1)
job_file2="$TEST_JOBS_DIR/${job_id2}.json"
bash "$JOB_SH" complete "$job_id2" "agent-x"
bash "$JOB_SH" fail "$job_id2" "agent-y" "stale_session_killed"
assert_eq "status is partial_failure" "partial_failure" "$(jq -r '.status' "$job_file2")"

# Test 5: list-pending
echo "--- Test: list-pending ---"
output3=$(bash "$JOB_SH" create orchestrator "Pending job" "agent-z")
job_id3=$(echo "$output3" | head -1)
pending=$(bash "$JOB_SH" list-pending)
echo "$pending" | grep -q "$job_id3"
assert_eq "list-pending includes pending job" "0" "$?"

# Test 6: status
echo "--- Test: status ---"
status_out=$(bash "$JOB_SH" status "$job_id")
echo "$status_out" | jq -e '.id' > /dev/null
assert_eq "status returns valid JSON" "0" "$?"

# Test 7: archive
echo "--- Test: archive ---"
bash "$JOB_SH" archive "$job_id"
assert_eq "job file removed from jobs/" "false" "$([ -f "$job_file" ] && echo true || echo false)"
assert_eq "job file in archive/" "true" "$([ -f "$TEST_JOBS_DIR/archive/${job_id}.json" ] && echo true || echo false)"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
