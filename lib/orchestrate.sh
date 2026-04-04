#!/usr/bin/env bash
set -euo pipefail

AGENTS_DIR="${AGENTS_DIR:-agents}"
SHARED_DIR="${AGENTS_DIR}/shared"

# Funções de orquestração migradas para handoffs (lib/handoff.sh)
# Este arquivo mantido para backwards compatibility — será removido em versão futura.
