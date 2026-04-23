// Delegado para dashboard/app/lib/cli-backend-client.ts (Fase 3).
// O wizard exibe somente os valores do backend ATIVO; o validator aceita
// a união com retrocompat via ALL_VALID_* (outro módulo).
import { validModels, validPermissionModes } from "../../../lib/cli-backend-client";

export const VALID_MODELS = validModels();
export type ModelId = string;

export const VALID_PERMISSION_MODES = validPermissionModes();
export type PermissionMode = string;

export const VALID_SCHEDULE_MODES = [
  "alive",
  "handoff-only",
  "disabled",
] as const;
export type ScheduleMode = (typeof VALID_SCHEDULE_MODES)[number];

export const VALID_LAYERS = [
  "infrastructure",
  "business",
  "service",
  "auxiliary",
] as const;

export interface WizardIntegration {
  enabled: boolean;
  [key: string]: unknown;
}

export interface WizardCollaborator {
  id?: string;
  agent: string;
  reason?: string;
  [key: string]: unknown;
}

export function isModelId(v: string): v is ModelId {
  return VALID_MODELS.includes(v);
}

export function isPermissionMode(v: string): v is PermissionMode {
  return VALID_PERMISSION_MODES.includes(v);
}

export function isScheduleMode(v: string): v is ScheduleMode {
  return (VALID_SCHEDULE_MODES as readonly string[]).includes(v);
}

export interface WizardFormState {
  name: string;
  display_name: string;
  domain: string[];
  layer: string;
  version: string;
  model: ModelId;
  fallback_model: ModelId;
  permission_mode: PermissionMode | "";
  working_directory: string;
  additional_dirs: string[];
  command: string;
  capabilities: string[];
  schedule_mode: ScheduleMode;
  schedule_interval: string;
  schedule_priority: number;
  schedule_run_alone: boolean;
  max_sessions_per_day: number;
  integrations: Record<string, WizardIntegration>;
  collaborators: WizardCollaborator[];
}

export interface FieldError {
  field: string;
  message: string;
}
