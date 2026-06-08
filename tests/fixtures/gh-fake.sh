#!/usr/bin/env bash
# Stub de gh para testes.

# gh search prs ...
if [ "${1:-}" = "search" ] && [ "${2:-}" = "prs" ]; then
  if printf '%s ' "$@" | grep -q -- '--review-requested'; then
    echo '[{"repository":{"nameWithOwner":"px-center/px-motor"},"number":482,"title":"retry webhook","url":"https://x/482","author":{"login":"maria"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-06T09:00:00Z"}]'
  elif printf '%s ' "$@" | grep -q -- '--author'; then
    # PR 91: approved, actionable (your_pr_stuck)
    # PR 92: not actionable (review_required, ci passing, no conflict) — deve ser descartado
    # PR 93: draft — deve ser descartado
    echo '[
      {"repository":{"nameWithOwner":"px-center/px-cortex"},"number":91,"title":"refactor","url":"https://x/91","author":{"login":"me"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-07T09:00:00Z"},
      {"repository":{"nameWithOwner":"px-center/px-cortex"},"number":92,"title":"wip not ready","url":"https://x/92","author":{"login":"me"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-06T09:00:00Z"},
      {"repository":{"nameWithOwner":"px-center/px-cortex"},"number":93,"title":"draft pr","url":"https://x/93","author":{"login":"me"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-06T09:00:00Z"}
    ]'
  else
    echo '[]'
  fi
  exit 0
fi

# gh pr view <number> --repo <repo> --json ...
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then
  local_number="${3:-}"
  local_repo=""
  i=4
  while [ $i -le $# ]; do
    arg="${!i}"
    if [ "$arg" = "--repo" ]; then
      i=$((i + 1))
      local_repo="${!i}"
    fi
    i=$((i + 1))
  done

  case "$local_number" in
    482)
      # review-requested, px-motor: not draft, reviewDecision null, mergeable MERGEABLE, ci passing
      echo '{
        "number": 482,
        "title": "retry webhook",
        "url": "https://x/482",
        "author": {"login": "maria"},
        "createdAt": "2026-06-06T09:00:00Z",
        "updatedAt": "2026-06-06T09:00:00Z",
        "isDraft": false,
        "reviewDecision": null,
        "mergeable": "MERGEABLE",
        "statusCheckRollup": [{"name":"build","conclusion":"SUCCESS","state":"SUCCESS"}]
      }'
      ;;
    91)
      # author, px-cortex: approved, ci passing, not draft
      echo '{
        "number": 91,
        "title": "refactor",
        "url": "https://x/91",
        "author": {"login": "me"},
        "createdAt": "2026-06-06T09:00:00Z",
        "updatedAt": "2026-06-07T09:00:00Z",
        "isDraft": false,
        "reviewDecision": "APPROVED",
        "mergeable": "MERGEABLE",
        "statusCheckRollup": [{"name":"build","conclusion":"SUCCESS","state":"SUCCESS"}]
      }'
      ;;
    92)
      # author, px-cortex: review required, ci passing, no conflict — NOT actionable, deve ser descartado
      echo '{
        "number": 92,
        "title": "wip not ready",
        "url": "https://x/92",
        "author": {"login": "me"},
        "createdAt": "2026-06-06T09:00:00Z",
        "updatedAt": "2026-06-06T09:00:00Z",
        "isDraft": false,
        "reviewDecision": "REVIEW_REQUIRED",
        "mergeable": "MERGEABLE",
        "statusCheckRollup": [{"name":"build","conclusion":"SUCCESS","state":"SUCCESS"}]
      }'
      ;;
    93)
      # draft — deve ser descartado
      echo '{
        "number": 93,
        "title": "draft pr",
        "url": "https://x/93",
        "author": {"login": "me"},
        "createdAt": "2026-06-06T09:00:00Z",
        "updatedAt": "2026-06-06T09:00:00Z",
        "isDraft": true,
        "reviewDecision": null,
        "mergeable": "MERGEABLE",
        "statusCheckRollup": []
      }'
      ;;
    *)
      echo '{
        "number": 0,
        "isDraft": false,
        "reviewDecision": null,
        "mergeable": "MERGEABLE",
        "statusCheckRollup": []
      }'
      ;;
  esac
  exit 0
fi

# gh pr list --repo <repo> --state open --json ...
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "list" ]; then
  local_repo=""
  i=3
  while [ $i -le $# ]; do
    arg="${!i}"
    if [ "$arg" = "--repo" ]; then
      i=$((i + 1))
      local_repo="${!i}"
    fi
    i=$((i + 1))
  done

  if [ "$local_repo" = "px-center/px-torre-core" ]; then
    # PR 700: old PR from another author — deve virar team_aging
    echo '[
      {"number": 700, "title": "old infra fix", "url": "https://x/700", "author": {"login": "outrapessoa"}, "createdAt": "2026-05-01T09:00:00Z", "isDraft": false}
    ]'
  else
    echo '[]'
  fi
  exit 0
fi

# gh api ...check-runs
if [ "${1:-}" = "api" ]; then
  echo '{"check_runs":[{"name":"build","conclusion":"failure"}]}'
  exit 0
fi

echo '[]'
