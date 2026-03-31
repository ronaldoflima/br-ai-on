import { parse } from "yaml";
import type { ConfigError } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: ConfigError[];
}

const VALID_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
];

const VALID_MODES = ["alive", "handoff-only", "disabled"];

const INTERVAL_RE = /^\d+(s|m|h|d)$/;

export function validateAgentConfig(raw: string): ValidationResult {
  const errors: ConfigError[] = [];

  let cfg: Record<string, unknown>;
  try {
    cfg = parse(raw);
  } catch (e) {
    return { valid: false, errors: [{ field: "yaml", message: `YAML inválido: ${e}` }] };
  }

  if (!cfg || typeof cfg !== "object") {
    return { valid: false, errors: [{ field: "yaml", message: "Config deve ser um objeto YAML" }] };
  }

  // Campos obrigatórios
  for (const field of ["name", "display_name", "domain", "version", "model", "fallback_model"] as const) {
    if (!cfg[field] || typeof cfg[field] !== "string") {
      errors.push({ field, message: `Campo obrigatório ausente ou inválido: ${field}` });
    }
  }

  // model e fallback_model devem ser modelos Claude válidos
  if (cfg.model && !VALID_MODELS.includes(cfg.model as string)) {
    errors.push({
      field: "model",
      message: `Modelo inválido "${cfg.model}". Válidos: ${VALID_MODELS.join(", ")}`,
    });
  }
  if (cfg.fallback_model && !VALID_MODELS.includes(cfg.fallback_model as string)) {
    errors.push({
      field: "fallback_model",
      message: `Modelo inválido "${cfg.fallback_model}". Válidos: ${VALID_MODELS.join(", ")}`,
    });
  }

  // schedule
  const sched = cfg.schedule as Record<string, unknown> | undefined;
  if (!sched || typeof sched !== "object") {
    errors.push({ field: "schedule", message: "Campo obrigatório: schedule" });
  } else {
    const mode = sched.mode as string | undefined;
    if (!mode || !VALID_MODES.includes(mode)) {
      errors.push({
        field: "schedule.mode",
        message: `schedule.mode inválido "${mode}". Válidos: ${VALID_MODES.join(", ")}`,
      });
    }
    if (mode === "alive") {
      const interval = sched.interval as string | undefined;
      if (!interval) {
        errors.push({ field: "schedule.interval", message: "schedule.interval obrigatório quando mode=alive" });
      } else if (!INTERVAL_RE.test(String(interval))) {
        errors.push({ field: "schedule.interval", message: `Intervalo inválido "${interval}". Formato: 15m, 1h, 2h, 7d` });
      }
      const priority = sched.priority;
      if (priority !== undefined && (typeof priority !== "number" || priority < 1)) {
        errors.push({ field: "schedule.priority", message: "schedule.priority deve ser número >= 1" });
      }
    }
  }

  // budget
  const budget = cfg.budget as Record<string, unknown> | undefined;
  if (!budget || typeof budget !== "object") {
    errors.push({ field: "budget", message: "Campo obrigatório: budget" });
  } else {
    if (!budget.max_sessions_per_day || typeof budget.max_sessions_per_day !== "number" || budget.max_sessions_per_day < 1) {
      errors.push({ field: "budget.max_sessions_per_day", message: "budget.max_sessions_per_day deve ser número >= 1" });
    }
    if (!budget.max_tokens_per_session || typeof budget.max_tokens_per_session !== "number" || budget.max_tokens_per_session < 1000) {
      errors.push({ field: "budget.max_tokens_per_session", message: "budget.max_tokens_per_session deve ser número >= 1000" });
    }
  }

  // version: semver simples
  if (cfg.version && !/^\d+\.\d+\.\d+$/.test(String(cfg.version))) {
    errors.push({ field: "version", message: `Versão inválida "${cfg.version}". Formato: 0.1.0` });
  }

  return { valid: errors.length === 0, errors };
}
