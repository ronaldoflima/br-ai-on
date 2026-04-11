export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "plan"
  | "dontAsk";

export type ScheduleMode = "alive" | "handoff-only" | "disabled";

export type ModelId =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "claude-haiku-4-5-20251001";

export interface WizardIntegration {
  enabled: boolean;
  [key: string]: unknown;
}

export interface WizardCollaborator {
  name: string;
  [key: string]: unknown;
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
  command: string;
  capabilities: string[];
  schedule_mode: ScheduleMode;
  schedule_interval: string;
  schedule_priority: number;
  schedule_run_alone: boolean;
  max_tokens_per_session: number;
  max_sessions_per_day: number;
  integrations: Record<string, WizardIntegration>;
  collaborators: WizardCollaborator[];
}

export interface FieldError {
  field: string;
  message: string;
}

export const VALID_MODELS: ModelId[] = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
];

export const VALID_PERMISSION_MODES: PermissionMode[] = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "plan",
  "dontAsk",
];

export const VALID_LAYERS = [
  "infrastructure",
  "business",
  "service",
  "auxiliary",
];

export const VALID_SCHEDULE_MODES: ScheduleMode[] = [
  "alive",
  "handoff-only",
  "disabled",
];
