"use client";
import { useState, useMemo } from "react";
import { stringify } from "yaml";
import { useRouter } from "next/navigation";
import {
  WizardFormState,
  WizardIntegration,
  WizardCollaborator,
  ModelId,
  PermissionMode,
  ScheduleMode,
  FieldError,
} from "./types";
import {
  IdentidadeSection,
  ModeloSection,
  RuntimeSection,
  CapabilitiesSection,
  ScheduleSection,
  BudgetSection,
  IntegracoesSection,
  ColaboradoresSection,
} from "./sections";
import { YamlPreview } from "./YamlPreview";
import styles from "./config-wizard.module.css";

function configToForm(raw: Record<string, unknown>): WizardFormState {
  const schedule = (raw.schedule ?? {}) as Record<string, unknown>;
  const budget = (raw.budget ?? {}) as Record<string, unknown>;
  const runtime = (raw.runtime ?? {}) as Record<string, Record<string, unknown>>;

  return {
    name: String(raw.name ?? ""),
    display_name: String(raw.display_name ?? ""),
    domain: Array.isArray(raw.domain)
      ? raw.domain.map(String)
      : raw.domain
      ? [String(raw.domain)]
      : [],
    layer: String(raw.layer ?? ""),
    version: String(raw.version ?? "1.0.0"),
    model: (raw.model as ModelId) ?? "claude-sonnet-4-6",
    fallback_model: (raw.fallback_model as ModelId) ?? "claude-haiku-4-5",
    permission_mode:
      (runtime.claude?.permission_mode as PermissionMode | "") ?? "",
    working_directory: String(raw.working_directory ?? ""),
    command: String(raw.command ?? ""),
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.map(String)
      : [],
    schedule_mode: (schedule.mode as ScheduleMode) ?? "handoff-only",
    schedule_interval: String(schedule.interval ?? ""),
    schedule_priority: Number(schedule.priority ?? 0),
    schedule_run_alone: Boolean(schedule.run_alone ?? false),
    max_tokens_per_session: Number(budget.max_tokens_per_session ?? 50000),
    max_sessions_per_day: Number(budget.max_sessions_per_day ?? 5),
    integrations:
      (raw.integrations as Record<string, WizardIntegration>) ?? {},
    collaborators: Array.isArray(raw.collaborators)
      ? (raw.collaborators as WizardCollaborator[])
      : [],
  };
}

function formToConfig(form: WizardFormState): Record<string, unknown> {
  const config: Record<string, unknown> = {
    name: form.name,
    display_name: form.display_name,
    domain: form.domain.length === 1 ? form.domain[0] : form.domain,
    version: form.version,
    model: form.model,
    fallback_model: form.fallback_model,
    schedule: {
      mode: form.schedule_mode,
      ...(form.schedule_mode === "alive"
        ? { interval: form.schedule_interval }
        : {}),
      ...(form.schedule_priority !== 0
        ? { priority: form.schedule_priority }
        : {}),
      ...(form.schedule_run_alone ? { run_alone: true } : {}),
    },
    budget: {
      max_tokens_per_session: form.max_tokens_per_session,
      max_sessions_per_day: form.max_sessions_per_day,
    },
  };

  if (form.layer) config.layer = form.layer;
  if (form.working_directory) config.working_directory = form.working_directory;
  if (form.command) config.command = form.command;
  if (form.capabilities.length > 0) config.capabilities = form.capabilities;
  if (form.permission_mode) {
    config.runtime = { claude: { permission_mode: form.permission_mode } };
  }
  if (Object.keys(form.integrations).length > 0) {
    config.integrations = form.integrations;
  }
  if (form.collaborators.length > 0) {
    config.collaborators = form.collaborators.map(({ id: _id, ...rest }) => rest);
  }

  return config;
}

interface Props {
  name: string;
  initialConfig: Record<string, unknown>;
}

export function ConfigWizard({ name, initialConfig }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<WizardFormState>(() =>
    configToForm(initialConfig),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [mobileTab, setMobileTab] = useState<"form" | "yaml">("form");

  const yamlString = useMemo(() => stringify(formToConfig(form)), [form]);

  function update(patch: Partial<WizardFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors([]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch(`/api/agents/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: yamlString }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus("Salvo!");
        setTimeout(() => router.push(`/agents/${name}`), 800);
      } else {
        setErrors(data.errors ?? []);
        setSaveStatus("Erro ao salvar");
      }
    } catch {
      setSaveStatus("Erro de conexão");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(""), 3000);
    }
  }

  const sectionProps = { form, update, errors };

  return (
    <div>
      {/* Abas — visíveis apenas em mobile via CSS */}
      <div className={styles.mobileTabs}>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobileTab === "form" ? styles.mobileTabActive : ""}`}
          onClick={() => setMobileTab("form")}
        >
          Formulário
        </button>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobileTab === "yaml" ? styles.mobileTabActive : ""}`}
          onClick={() => setMobileTab("yaml")}
        >
          YAML
        </button>
      </div>

      <div className={styles.container}>
        {/* Painel do formulário */}
        <div
          className={`${styles.formPanel} ${mobileTab !== "form" ? styles.formPanelHidden : ""}`}
        >
          <IdentidadeSection {...sectionProps} />
          <ModeloSection {...sectionProps} />
          <RuntimeSection {...sectionProps} />
          <CapabilitiesSection {...sectionProps} />
          <ScheduleSection {...sectionProps} />
          <BudgetSection {...sectionProps} />
          <IntegracoesSection {...sectionProps} />
          <ColaboradoresSection {...sectionProps} />

          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={() => router.push(`/agents/${name}`)}
            >
              Cancelar
            </button>
            {saveStatus && (
              <span
                className={`${styles.saveStatus} ${
                  saveStatus.includes("Erro") ? styles.saveStatusError : ""
                }`}
              >
                {saveStatus}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || errors.length > 0}
            >
              {saving ? "Salvando..." : "Salvar nova versão"}
            </button>
          </div>
        </div>

        {/* Painel de preview YAML */}
        <div
          className={`${styles.previewPanel} ${mobileTab !== "yaml" ? styles.previewPanelHidden : ""}`}
        >
          <YamlPreview yaml={yamlString} />
        </div>
      </div>
    </div>
  );
}
