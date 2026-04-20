/**
 * cli-backend.ts — Espelho TypeScript de lib/cli.sh (Fase 3 da abstração).
 *
 * Centraliza constantes e paths específicos do backend AI CLI para o
 * dashboard Next.js. Nenhum arquivo do dashboard deve ter nomes de modelo,
 * paths `~/.claude/`, `.claude/projects`, ou labels "Claude Code" hardcoded —
 * tudo passa por aqui (server-side) ou por cli-backend-client.ts (client).
 *
 * Este arquivo É server-only (usa os/path). Para uso em "use client",
 * importe de ./cli-backend-client.
 *
 * Mantenha em sincronia com lib/cli.sh (fonte de verdade para runtime bash).
 */
import os from "os";
import path from "path";

export * from "./cli-backend-client";
import { CLI_BACKEND, type CliBackend } from "./cli-backend-client";

// ── Paths (server-only) ──────────────────────────────────────────────────────

export function configDir(backend: CliBackend = CLI_BACKEND): string {
  const home = os.homedir();
  switch (backend) {
    case "claude": return path.join(home, ".claude");
    case "codex": return path.join(home, ".codex");
    case "gemini": return path.join(home, ".gemini");
  }
}

export function commandsInstallDir(backend: CliBackend = CLI_BACKEND): string {
  const home = os.homedir();
  switch (backend) {
    case "claude": return path.join(home, ".claude", "commands");
    case "codex": return path.join(home, ".codex", "prompts");
    case "gemini": return path.join(home, ".gemini", "commands");
  }
}

export function projectsDir(backend: CliBackend = CLI_BACKEND): string {
  const home = os.homedir();
  switch (backend) {
    case "claude": return path.join(home, ".claude", "projects");
    case "codex": return path.join(home, ".codex", "sessions");
    case "gemini": return path.join(home, ".gemini", "sessions");
  }
}
