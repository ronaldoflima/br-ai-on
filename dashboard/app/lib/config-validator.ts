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

const VALID_CLAUDE_PERMISSION_MODES = [
  "acceptEdits", "auto", "bypassPermissions", "plan", "dontAsk",
];

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "name", "display_name", "domain", "layer", "directory", "working_directory",
  "version", "model", "fallback_model", "command",
  "runtime", "capabilities",
  "schedule", "budget", "integrations", "collaborators",
]);

const KNOWN_SCHEDULE_FIELDS = new Set([
  "mode", "interval", "priority", "run_alone",
]);

const KNOWN_BUDGET_FIELDS = new Set([
  "max_sessions_per_day",
]);

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

  for (const key of Object.keys(cfg)) {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
      errors.push({ field: key, message: `Campo desconhecido: "${key}"` });
    }
  }

  for (const field of ["name", "display_name", "version", "model", "fallback_model"] as const) {
    if (!cfg[field] || typeof cfg[field] !== "string") {
      errors.push({ field, message: `Campo obrigatório ausente ou inválido: ${field}` });
    }
  }

  if (!cfg.domain) {
    errors.push({ field: "domain", message: "Campo obrigatório ausente ou inválido: domain" });
  } else if (typeof cfg.domain !== "string" && !Array.isArray(cfg.domain)) {
    errors.push({ field: "domain", message: "domain deve ser uma string ou array de strings" });
  } else if (Array.isArray(cfg.domain)) {
    const invalid = cfg.domain.filter((t: unknown) => typeof t !== "string" || !(t as string).trim());
    if (invalid.length > 0) {
      errors.push({ field: "domain", message: "Todos os itens de domain devem ser strings não-vazias" });
    }
  }

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
    for (const key of Object.keys(sched)) {
      if (!KNOWN_SCHEDULE_FIELDS.has(key)) {
        errors.push({ field: `schedule.${key}`, message: `Campo desconhecido em schedule: "${key}"` });
      }
    }
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
    }
    const priority = sched.priority;
    if (priority !== undefined && (typeof priority !== "number" || priority < 0)) {
      errors.push({ field: "schedule.priority", message: "schedule.priority deve ser número >= 0" });
    }
    if (sched.run_alone !== undefined && typeof sched.run_alone !== "boolean") {
      errors.push({ field: "schedule.run_alone", message: "schedule.run_alone deve ser boolean" });
    }
  }

  // budget
  const budget = cfg.budget as Record<string, unknown> | undefined;
  if (!budget || typeof budget !== "object") {
    errors.push({ field: "budget", message: "Campo obrigatório: budget" });
  } else {
    for (const key of Object.keys(budget)) {
      if (!KNOWN_BUDGET_FIELDS.has(key)) {
        errors.push({ field: `budget.${key}`, message: `Campo desconhecido em budget: "${key}"` });
      }
    }
    if (!budget.max_sessions_per_day || typeof budget.max_sessions_per_day !== "number" || budget.max_sessions_per_day < 1) {
      errors.push({ field: "budget.max_sessions_per_day", message: "budget.max_sessions_per_day deve ser número >= 1" });
    }
  }

  // integrations: opcional, mas se presente cada chave deve ter enabled: boolean
  if (cfg.integrations !== undefined) {
    if (typeof cfg.integrations !== "object" || cfg.integrations === null || Array.isArray(cfg.integrations)) {
      errors.push({ field: "integrations", message: "integrations deve ser um objeto" });
    } else {
      const integrations = cfg.integrations as Record<string, unknown>;
      for (const [key, value] of Object.entries(integrations)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          errors.push({ field: `integrations.${key}`, message: `integrations.${key} deve ser um objeto` });
          continue;
        }
        const integration = value as Record<string, unknown>;
        if (typeof integration.enabled !== "boolean") {
          errors.push({
            field: `integrations.${key}.enabled`,
            message: `integrations.${key}.enabled é obrigatório e deve ser boolean`,
          });
        }
      }
    }
  }

  if (cfg.directory !== undefined) {
    if (typeof cfg.directory !== "string") {
      errors.push({ field: "directory", message: "directory deve ser uma string" });
    } else if (!cfg.directory.startsWith("/")) {
      errors.push({ field: "directory", message: "directory deve ser um caminho absoluto" });
    }
  }

  // version: semver simples
  if (cfg.version && !/^\d+\.\d+\.\d+$/.test(String(cfg.version))) {
    errors.push({ field: "version", message: `Versão inválida "${cfg.version}". Formato: 0.1.0` });
  }

  // command: opcional, string quando presente
  if (cfg.command !== undefined && typeof cfg.command !== "string") {
    errors.push({ field: "command", message: "command deve ser uma string" });
  }

  // layer: opcional, string quando presente
  if (cfg.layer !== undefined && typeof cfg.layer !== "string") {
    errors.push({ field: "layer", message: "layer deve ser uma string" });
  }

  // capabilities: opcional, array de strings não-vazias
  if (cfg.capabilities !== undefined) {
    if (!Array.isArray(cfg.capabilities)) {
      errors.push({ field: "capabilities", message: "capabilities deve ser um array de strings" });
    } else {
      const invalid = cfg.capabilities.filter((c: unknown) => typeof c !== "string" || !(c as string).trim());
      if (invalid.length > 0) {
        errors.push({ field: "capabilities", message: "Todos os itens de capabilities devem ser strings não-vazias" });
      }
    }
  }

  // runtime: opcional, configurações específicas por executor de AI
  if (cfg.runtime !== undefined) {
    if (typeof cfg.runtime !== "object" || cfg.runtime === null || Array.isArray(cfg.runtime)) {
      errors.push({ field: "runtime", message: "runtime deve ser um objeto" });
    } else {
      const runtime = cfg.runtime as Record<string, unknown>;
      const claude = runtime.claude as Record<string, unknown> | undefined;
      if (claude !== undefined) {
        if (typeof claude !== "object" || claude === null || Array.isArray(claude)) {
          errors.push({ field: "runtime.claude", message: "runtime.claude deve ser um objeto" });
        } else {
          const pm = claude.permission_mode;
          if (pm !== undefined && !VALID_CLAUDE_PERMISSION_MODES.includes(pm as string)) {
            errors.push({
              field: "runtime.claude.permission_mode",
              message: `permission_mode inválido "${pm}". Válidos: ${VALID_CLAUDE_PERMISSION_MODES.join(", ")}`,
            });
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
