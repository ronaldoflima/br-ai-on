#!/usr/bin/env bash
# Stub de gh para testes. Responde a `gh search prs ...` com JSON fixo,
# e a `gh api ...check-runs` com um run falhando. Ignora os demais.
if [ "${1:-}" = "search" ] && [ "${2:-}" = "prs" ]; then
  if printf '%s ' "$@" | grep -q -- '--review-requested'; then
    echo '[{"repository":{"nameWithOwner":"px-center/px-motor"},"number":482,"title":"retry webhook","url":"https://x/482","author":{"login":"maria"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-06T09:00:00Z"}]'
  elif printf '%s ' "$@" | grep -q -- '--author'; then
    echo '[{"repository":{"nameWithOwner":"px-center/px-cortex"},"number":91,"title":"refactor","url":"https://x/91","author":{"login":"me"},"createdAt":"2026-06-07T09:00:00Z","updatedAt":"2026-06-07T09:00:00Z"}]'
  else
    echo '[]'
  fi
  exit 0
fi
if [ "${1:-}" = "api" ]; then
  echo '{"check_runs":[{"name":"build","conclusion":"failure"}]}'
  exit 0
fi
echo '[]'
