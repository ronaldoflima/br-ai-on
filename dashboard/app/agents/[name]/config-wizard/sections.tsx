"use client";
import { useState, KeyboardEvent } from "react";
import { AccordionSection } from "./AccordionSection";
import {
  WizardFormState,
  VALID_MODELS,
  VALID_PERMISSION_MODES,
  VALID_LAYERS,
  VALID_SCHEDULE_MODES,
  FieldError,
  WizardIntegration,
  WizardCollaborator,
  isModelId,
  isPermissionMode,
  isScheduleMode,
} from "./types";
import styles from "./config-wizard.module.css";

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type Update = (patch: Partial<WizardFormState>) => void;

interface SectionProps {
  form: WizardFormState;
  update: Update;
  errors: FieldError[];
}

function fieldError(errors: FieldError[], field: string): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

// ─── Identidade ───────────────────────────────────────────────────────────────

export function IdentidadeSection({ form, update, errors }: SectionProps) {
  const [tagInput, setTagInput] = useState("");
  const hasError = ["display_name", "domain", "version"].some((f) =>
    fieldError(errors, f),
  );

  const displayNameError = fieldError(errors, "display_name");
  const domainError = fieldError(errors, "domain");
  const versionError = fieldError(errors, "version");

  function addDomain(val: string) {
    const v = val.trim();
    if (v && !form.domain.includes(v)) {
      update({ domain: [...form.domain, v] });
    }
    setTagInput("");
  }

  function removeDomain(val: string) {
    update({ domain: form.domain.filter((d) => d !== val) });
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDomain(tagInput);
    }
    if (e.key === "Backspace" && tagInput === "" && form.domain.length > 0) {
      removeDomain(form.domain[form.domain.length - 1]);
    }
  }

  return (
    <AccordionSection title="Identidade" hasError={hasError} defaultOpen>
      <div className={styles.legend}>
        Informações básicas do agente. <strong>name</strong> é o identificador
        imutável (slug) — não editável aqui. <strong>domain</strong> define as
        áreas de conhecimento: use vírgulas ou Enter para adicionar tags.{" "}
        <strong>layer</strong> indica o papel arquitetural (infrastructure,
        business, service, auxiliary). <strong>version</strong> segue semver
        (X.Y.Z).
      </div>

      <div className="form-group">
        <label className="form-label">name</label>
        <input
          className="input"
          value={form.name}
          disabled
          readOnly
          style={{ opacity: 0.6 }}
        />
      </div>

      <div className="form-group">
        <label className="form-label">display_name</label>
        <input
          className="input"
          value={form.display_name}
          onChange={(e) => update({ display_name: e.target.value })}
          placeholder="Nome legível do agente"
        />
        {displayNameError && (
          <span className={styles.fieldError}>{displayNameError}</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">domain</label>
        <div
          className={styles.tagInput}
          onClick={() => document.getElementById("domain-input")?.focus()}
        >
          {form.domain.map((d) => (
            <span key={d} className={styles.tag}>
              {d}
              <button
                type="button"
                className={styles.tagRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  removeDomain(d);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="domain-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => {
              if (tagInput.trim()) addDomain(tagInput);
            }}
            placeholder={
              form.domain.length === 0 ? "orquestracao, coordenacao..." : ""
            }
          />
        </div>
        {domainError && (
          <span className={styles.fieldError}>{domainError}</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">layer</label>
        <input
          className="input"
          list="layer-suggestions"
          value={form.layer}
          onChange={(e) => update({ layer: e.target.value })}
          placeholder="infrastructure, business, service..."
        />
        <datalist id="layer-suggestions">
          {VALID_LAYERS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>

      <div className="form-group">
        <label className="form-label">version</label>
        <input
          className="input"
          value={form.version}
          onChange={(e) => update({ version: e.target.value })}
          placeholder="1.0.0"
        />
        {versionError && (
          <span className={styles.fieldError}>{versionError}</span>
        )}
      </div>
    </AccordionSection>
  );
}

// ─── Modelo ───────────────────────────────────────────────────────────────────

export function ModeloSection({ form, update, errors }: SectionProps) {
  const hasError = ["model", "fallback_model"].some((f) =>
    fieldError(errors, f),
  );

  return (
    <AccordionSection title="Modelo" hasError={hasError}>
      <div className={styles.legend}>
        <strong>model</strong> é o modelo principal usado nas sessões.{" "}
        <strong>fallback_model</strong> é usado quando o principal não está
        disponível. Prefira modelos mais capazes como principal (opus/sonnet) e
        mais rápidos como fallback (haiku).
      </div>

      <div className="form-group">
        <label className="form-label">model</label>
        <select
          className="select"
          value={form.model}
          onChange={(e) => {
            if (isModelId(e.target.value)) update({ model: e.target.value });
          }}
        >
          {VALID_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">fallback_model</label>
        <select
          className="select"
          value={form.fallback_model}
          onChange={(e) => {
            if (isModelId(e.target.value))
              update({ fallback_model: e.target.value });
          }}
        >
          {VALID_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </AccordionSection>
  );
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export function RuntimeSection({ form, update, errors }: SectionProps) {
  const hasError =
    Boolean(fieldError(errors, "runtime.permission_mode")) ||
    Boolean(fieldError(errors, "runtime.claude.permission_mode"));
  const permissionModeError =
    fieldError(errors, "runtime.permission_mode") ||
    fieldError(errors, "runtime.claude.permission_mode");

  return (
    <AccordionSection title="Runtime" hasError={hasError}>
      <div className={styles.legend}>
        <strong>permission_mode</strong>: controla autonomia do agente.
        Valores genéricos (portáveis entre backends):{" "}
        <em>auto</em> aceita edits automaticamente, <em>confirm</em> pede
        confirmação, <em>bypass</em> ignora todas as permissões (use com
        cuidado). Os valores claude-native (<em>acceptEdits</em>,{" "}
        <em>bypassPermissions</em>, <em>plan</em>, <em>dontAsk</em>) continuam
        aceitos por retrocompat. <strong>working_directory</strong> e{" "}
        <strong>command</strong> são opcionais — definem onde e como iniciar o
        agente.
      </div>

      <div className="form-group">
        <label className="form-label">permission_mode</label>
        <select
          className="select"
          value={form.permission_mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || isPermissionMode(v))
              update({ permission_mode: v === "" ? "" : v });
          }}
        >
          <option value="">— não definido —</option>
          {VALID_PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {permissionModeError && (
          <span className={styles.fieldError}>{permissionModeError}</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">working_directory (primário)</label>
        <input
          className="input"
          value={form.working_directory}
          onChange={(e) => update({ working_directory: e.target.value })}
          placeholder="/caminho/absoluto/opcional"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Diretórios adicionais (--add-dir)</label>
        {form.additional_dirs.map((dir, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <input
              className="input"
              value={dir}
              onChange={(e) => {
                const updated = [...form.additional_dirs];
                updated[i] = e.target.value;
                update({ additional_dirs: updated });
              }}
              placeholder="/caminho/absoluto"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const updated = form.additional_dirs.filter((_, idx) => idx !== i);
                update({ additional_dirs: updated });
              }}
            >
              X
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => update({ additional_dirs: [...form.additional_dirs, ""] })}
        >
          + Adicionar diretório
        </button>
      </div>

      <div className="form-group">
        <label className="form-label">command</label>
        <input
          className="input"
          value={form.command}
          onChange={(e) => update({ command: e.target.value })}
          placeholder="Comando opcional de inicialização"
        />
      </div>
    </AccordionSection>
  );
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

export function CapabilitiesSection({ form, update }: SectionProps) {
  const [capItems, setCapItems] = useState(() =>
    form.capabilities.map((value) => ({ id: genId(), value })),
  );
  const [newCap, setNewCap] = useState("");

  function syncUp(items: { id: string; value: string }[]) {
    setCapItems(items);
    update({ capabilities: items.map((c) => c.value) });
  }

  function updateCap(id: string, value: string) {
    syncUp(capItems.map((c) => (c.id === id ? { ...c, value } : c)));
  }

  function removeCap(id: string) {
    syncUp(capItems.filter((c) => c.id !== id));
  }

  function addCap() {
    const v = newCap.trim();
    if (v) {
      syncUp([...capItems, { id: genId(), value: v }]);
      setNewCap("");
    }
  }

  return (
    <AccordionSection title="Capabilities">
      <div className={styles.legend}>
        Lista de capacidades do agente — frases curtas que descrevem o que ele
        pode fazer. Usadas para roteamento dinâmico e para contextualizar outros
        agentes que precisam delegar tarefas.
      </div>

      {capItems.map((cap) => (
        <div key={cap.id} className={styles.listItem}>
          <input
            className="input"
            value={cap.value}
            onChange={(e) => updateCap(cap.id, e.target.value)}
          />
          <button type="button" className="btn" onClick={() => removeCap(cap.id)}>
            ×
          </button>
        </div>
      ))}

      <div className={styles.listItem}>
        <input
          className="input"
          value={newCap}
          onChange={(e) => setNewCap(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCap();
            }
          }}
          placeholder="Nova capability (Enter para adicionar)"
        />
        <button type="button" className="btn btn-primary" onClick={addCap}>
          +
        </button>
      </div>
    </AccordionSection>
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export function ScheduleSection({ form, update, errors }: SectionProps) {
  const hasError = ["schedule.mode", "schedule.interval"].some((f) =>
    fieldError(errors, f),
  );
  const scheduleIntervalError = fieldError(errors, "schedule.interval");

  return (
    <AccordionSection title="Schedule" hasError={hasError}>
      <div className={styles.legend}>
        <strong>mode</strong>: <em>alive</em> = roda automaticamente em
        intervalos; <em>handoff-only</em> = só executa quando recebe um handoff;{" "}
        <em>disabled</em> = inativo. <strong>interval</strong>: obrigatório se
        mode=alive. Exemplos: <code>15m</code>, <code>1h</code>,{" "}
        <code>7d</code>. <strong>priority</strong>: prioridade de execução (0 =
        normal). <strong>run_alone</strong>: se true, não executa em paralelo
        com outros agentes.
      </div>

      <div className="form-group">
        <label className="form-label">mode</label>
        <select
          className="select"
          value={form.schedule_mode}
          onChange={(e) => {
            if (isScheduleMode(e.target.value))
              update({ schedule_mode: e.target.value });
          }}
        >
          {VALID_SCHEDULE_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {form.schedule_mode === "alive" && (
        <div className="form-group">
          <label className="form-label">interval</label>
          <input
            className="input"
            value={form.schedule_interval}
            onChange={(e) => update({ schedule_interval: e.target.value })}
            placeholder="15m"
          />
          {scheduleIntervalError && (
            <span className={styles.fieldError}>{scheduleIntervalError}</span>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">priority</label>
        <input
          className="input"
          type="number"
          min={0}
          value={form.schedule_priority}
          onChange={(e) => update({ schedule_priority: Number(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label
          className="form-label"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            type="checkbox"
            checked={form.schedule_run_alone}
            onChange={(e) => update({ schedule_run_alone: e.target.checked })}
          />
          run_alone
        </label>
      </div>
    </AccordionSection>
  );
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export function BudgetSection({ form, update, errors }: SectionProps) {
  const hasError = Boolean(fieldError(errors, "budget.max_sessions_per_day"));
  const maxSessionsError = fieldError(errors, "budget.max_sessions_per_day");

  return (
    <AccordionSection title="Budget" hasError={hasError}>
      <div className={styles.legend}>
        Limites por agente. <strong>max_sessions_per_day</strong>: quantas
        sessões o agente pode iniciar por dia (mín. 1).
      </div>

      <div className="form-group">
        <label className="form-label">max_sessions_per_day</label>
        <input
          className="input"
          type="number"
          min={1}
          value={form.max_sessions_per_day}
          onChange={(e) =>
            update({ max_sessions_per_day: Number(e.target.value) })
          }
        />
        {maxSessionsError && (
          <span className={styles.fieldError}>{maxSessionsError}</span>
        )}
      </div>
    </AccordionSection>
  );
}

// ─── Integrações ──────────────────────────────────────────────────────────────

export function IntegracoesSection({ form, update }: SectionProps) {
  const integrationKeys = Object.keys(form.integrations);

  function toggleEnabled(key: string, enabled: boolean) {
    update({
      integrations: {
        ...form.integrations,
        [key]: { ...form.integrations[key], enabled },
      },
    });
  }

  function updateField(key: string, field: string, value: string) {
    update({
      integrations: {
        ...form.integrations,
        [key]: { ...form.integrations[key], [field]: value },
      },
    });
  }

  if (integrationKeys.length === 0) {
    return (
      <AccordionSection title="Integrações">
        <div className={styles.legend}>
          Nenhuma integração configurada neste agente. Para adicionar, edite o{" "}
          <code>config.yaml</code> diretamente com a chave{" "}
          <code>integrations</code> e reabra o wizard.
        </div>
      </AccordionSection>
    );
  }

  return (
    <AccordionSection title="Integrações">
      <div className={styles.legend}>
        Ativa ou desativa MCPs para este agente.{" "}
        <strong>telegram</strong>: notificações e comandos via bot.{" "}
        <strong>notion</strong>: leitura e escrita de páginas.{" "}
        <strong>obsidian</strong>: acesso ao vault pessoal.{" "}
        <strong>superset</strong>: queries em dashboards de dados. Campos
        adicionais aparecem ao ativar a integração.
      </div>

      {integrationKeys.map((key) => {
        const integration = form.integrations[key];
        const extraFields = Object.entries(integration).filter(
          ([k]) => k !== "enabled",
        );

        return (
          <div key={key}>
            <div className={styles.integrationRow}>
              <input
                type="checkbox"
                id={`integration-${key}`}
                checked={integration.enabled}
                onChange={(e) => toggleEnabled(key, e.target.checked)}
              />
              <label
                htmlFor={`integration-${key}`}
                className={styles.integrationName}
              >
                {key}
              </label>
            </div>

            {integration.enabled && extraFields.length > 0 && (
              <div className={styles.integrationFields}>
                {extraFields.map(([field, value]) => (
                  <div key={field} className={styles.integrationFieldRow}>
                    <label>{field}</label>
                    <input
                      className="input"
                      value={String(value ?? "")}
                      onChange={(e) => updateField(key, field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </AccordionSection>
  );
}

// ─── Colaboradores ────────────────────────────────────────────────────────────

export function ColaboradoresSection({ form, update }: SectionProps) {
  const [colItems, setColItems] = useState(() =>
    form.collaborators.map((col) => ({
      id: col.id ?? genId(),
      agent: col.agent,
    })),
  );

  function syncUp(items: { id: string; agent: string }[]) {
    setColItems(items);
    update({ collaborators: items });
  }

  function addCollaborator() {
    syncUp([...colItems, { id: genId(), agent: "" }]);
  }

  function removeCollaborator(id: string) {
    syncUp(colItems.filter((c) => c.id !== id));
  }

  function updateAgent(id: string, value: string) {
    syncUp(colItems.map((c) => (c.id === id ? { ...c, agent: value } : c)));
  }

  return (
    <AccordionSection title="Colaboradores">
      <div className={styles.legend}>
        Outros agentes com quem este agente colabora diretamente. O campo{" "}
        <strong>agent</strong> é o slug do agente colaborador (ex:{" "}
        <code>inbox-router</code>). Usado pelo sistema para definir rotas de
        handoff e contexto compartilhado.
      </div>

      {colItems.map((col) => (
        <div key={col.id} className={styles.listItem}>
          <input
            className="input"
            value={col.agent}
            onChange={(e) => updateAgent(col.id, e.target.value)}
            placeholder="slug-do-agente"
          />
          <button
            type="button"
            className="btn"
            onClick={() => removeCollaborator(col.id)}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn"
        onClick={addCollaborator}
        style={{ marginTop: 8 }}
      >
        + Adicionar colaborador
      </button>
    </AccordionSection>
  );
}
