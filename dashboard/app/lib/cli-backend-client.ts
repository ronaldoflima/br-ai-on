/**
 * cli-backend-client.ts — Parte client-safe da abstração de backend AI CLI.
 *
 * Sem imports Node (os, path, fs). Pode ser usado em client components.
 * Para paths de filesystem, use ./cli-backend (server-only).
 */

export type CliBackend = "claude" | "codex" | "gemini";

export const CLI_BACKEND: CliBackend =
  ((typeof process !== "undefined" &&
    ((process.env.CLI_BACKEND as CliBackend) ||
      (process.env.CLAUDE as CliBackend))) ||
    "claude") as CliBackend;

// ── Labels ────────────────────────────────────────────────────────────────────

const BACKEND_LABELS: Record<CliBackend, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export function backendLabel(backend: CliBackend = CLI_BACKEND): string {
  return BACKEND_LABELS[backend] ?? backend;
}

// ── Models ────────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<CliBackend, string> = {
  claude: "claude-sonnet-4-6",
  codex: "gpt-5-codex",
  gemini: "gemini-2.5-pro",
};

const FALLBACK_MODELS: Record<CliBackend, string> = {
  claude: "claude-haiku-4-5",
  codex: "gpt-5-mini",
  gemini: "gemini-2.5-flash",
};

const VALID_MODELS_BY_BACKEND: Record<CliBackend, readonly string[]> = {
  claude: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-5",
  ],
  codex: ["gpt-5-codex", "gpt-5-mini", "o4-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};

export function defaultModel(backend: CliBackend = CLI_BACKEND): string {
  return DEFAULT_MODELS[backend] ?? DEFAULT_MODELS.claude;
}

export function fallbackModel(backend: CliBackend = CLI_BACKEND): string {
  return FALLBACK_MODELS[backend] ?? FALLBACK_MODELS.claude;
}

export function validModels(
  backend: CliBackend = CLI_BACKEND,
): readonly string[] {
  return VALID_MODELS_BY_BACKEND[backend] ?? VALID_MODELS_BY_BACKEND.claude;
}

/**
 * Union de todos os modelos conhecidos de todos os backends.
 * Útil em validators que querem aceitar qualquer modelo (retrocompat).
 */
export const ALL_VALID_MODELS: readonly string[] = Array.from(
  new Set(Object.values(VALID_MODELS_BY_BACKEND).flat()),
);

// ── Permission modes ─────────────────────────────────────────────────────────

/** Genéricos portáveis entre backends. */
export const GENERIC_PERMISSION_MODES = ["auto", "confirm", "bypass"] as const;

const NATIVE_PERMISSION_MODES: Record<CliBackend, readonly string[]> = {
  claude: ["acceptEdits", "bypassPermissions", "plan", "dontAsk", "default"],
  codex: ["full-auto"],
  gemini: ["yolo"],
};

export function validPermissionModes(
  backend: CliBackend = CLI_BACKEND,
): readonly string[] {
  return [
    ...GENERIC_PERMISSION_MODES,
    ...(NATIVE_PERMISSION_MODES[backend] ?? []),
  ];
}

/** Union de todos os modes conhecidos (p/ validator com retrocompat). */
export const ALL_VALID_PERMISSION_MODES: readonly string[] = Array.from(
  new Set([
    ...GENERIC_PERMISSION_MODES,
    ...Object.values(NATIVE_PERMISSION_MODES).flat(),
  ]),
);
