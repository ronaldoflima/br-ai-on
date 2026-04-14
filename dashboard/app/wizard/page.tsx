"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { defaultModel, validModels } from "../lib/cli-backend-client";

const STEPS = ["Básico", "Personalidade", "Configuração", "Revisão & Envio"];

export default function WizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");

  const [personality, setPersonality] = useState("");
  const [scope, setScope] = useState("");

  const [scheduleMode, setScheduleMode] = useState<"alive" | "handoff-only" | "disabled">("handoff-only");
  const [interval, setInterval] = useState("30m");
  const [model, setModel] = useState(defaultModel());
  const [maxSessions, setMaxSessions] = useState(10);
  const [maxTokens, setMaxTokens] = useState(50000);

  const nameValid = /^[a-z0-9-]+$/.test(name);
  const canNext = () => {
    if (step === 0) return name.length > 0 && nameValid && displayName.trim().length > 0;
    return true;
  };

  function buildSpec() {
    return `# Especificação do Agente: ${displayName}

## Identidade
- Nome: ${name}
- Display Name: ${displayName}
- Domínio: ${domain}

## Personalidade
${personality}

## Escopo de Atuação
${scope}

## Configuração
- Schedule Mode: ${scheduleMode}
${scheduleMode === "alive" ? `- Interval: ${interval}\n` : ""}- Model: ${model}
- Max Sessions/Dia: ${maxSessions}
- Max Tokens/Sessão: ${maxTokens}`;
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "user",
          to: "agent-builder",
          expects: "action",
          description: `Criar agente: ${displayName}`,
          context: buildSpec(),
          expected: "Criar estrutura completa do agente conforme especificacao",
        }),
      });
      if (!res.ok) throw new Error("Falha ao criar handoff");
      router.push("/agents");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  const stepIndicator = (
    <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
      {STEPS.map((label, i) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              background: i < step ? "var(--success)" : i === step ? "var(--accent)" : "var(--bg-secondary)",
              color: i <= step ? "#fff" : "var(--text-muted)",
              border: i > step ? "1px solid var(--border)" : "none",
            }}
          >
            {i < step ? "✓" : i + 1}
          </div>
          <span style={{ fontSize: 12, color: i === step ? "var(--text-primary)" : "var(--text-muted)", display: i === step ? "inline" : "none" }}>
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <div style={{ width: 24, height: 1, background: i < step ? "var(--success)" : "var(--border)" }} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Criar Novo Agente</h1>
      </div>

      {stepIndicator}

      <div className="card" style={{ padding: 24 }}>
        {step === 0 && (
          <div>
            <h2 className="subsection-title">Informações Básicas</h2>
            <div className="form-group">
              <label className="form-label">Nome do agente</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="meu-agente"
              />
              {name.length > 0 && !nameValid && (
                <span style={{ fontSize: 11, color: "var(--error)" }}>Apenas letras minúsculas, números e hífens</span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Display name</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Meu Agente" />
            </div>
            <div className="form-group">
              <label className="form-label">Domínio</label>
              <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="ex: financeiro, produtividade, monitoramento" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="subsection-title">Personalidade & Escopo</h2>
            <div className="form-group">
              <label className="form-label">Descreva a personalidade e comportamento do agente</label>
              <textarea className="textarea" value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="Ex: Proativo, direto, foca em resultados. Comunica de forma concisa..." />
            </div>
            <div className="form-group">
              <label className="form-label">Escopo de atuação — o que este agente deve fazer?</label>
              <textarea className="textarea" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Ex: Monitorar métricas de vendas diárias, alertar quando houver queda..." />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="subsection-title">Configuração</h2>
            <div className="form-group">
              <label className="form-label">Schedule Mode</label>
              <select className="select" value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value as "alive" | "handoff-only" | "disabled")}>
                <option value="alive">alive — roda em intervalo fixo automaticamente</option>
                <option value="handoff-only">handoff-only — só executa quando recebe handoff</option>
                <option value="disabled">disabled — desativado</option>
              </select>
            </div>
            {scheduleMode === "alive" && (
              <div className="form-group">
                <label className="form-label">Intervalo</label>
                <input className="input" value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="30m" />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Modelo</label>
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                {validModels().map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Max sessões por dia</label>
                <input className="input" type="number" value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label className="form-label">Max tokens por sessão</label>
                <input className="input" type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="subsection-title">Revisão</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <div className="text-muted-xs">Nome</div>
                <div className="mono-sm">{name}</div>
              </div>
              <div>
                <div className="text-muted-xs">Display Name</div>
                <div>{displayName}</div>
              </div>
              <div>
                <div className="text-muted-xs">Domínio</div>
                <div>{domain || "—"}</div>
              </div>
              <div>
                <div className="text-muted-xs">Modelo</div>
                <div className="mono-sm">{model}</div>
              </div>
              <div>
                <div className="text-muted-xs">Schedule</div>
                <div>{scheduleMode}{scheduleMode === "alive" ? ` (${interval})` : ""}</div>
              </div>
              <div>
                <div className="text-muted-xs">Limites</div>
                <div className="mono-sm">{maxSessions} sessões/dia, {maxTokens} tokens/sessão</div>
              </div>
            </div>
            <div>
              <div className="text-muted-xs" style={{ marginBottom: 4 }}>Spec gerada (será enviada como handoff)</div>
              <pre className="card" style={{ background: "var(--bg-input)", whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 300, overflow: "auto" }}>
                {buildSpec()}
              </pre>
            </div>
            {error && <div style={{ color: "var(--error)", fontSize: 13, marginTop: 8 }}>{error}</div>}
          </div>
        )}

        <div className="flex-between" style={{ marginTop: 24 }}>
          <div>
            {step > 0 && (
              <button className="btn" onClick={() => setStep(step - 1)}>Voltar</button>
            )}
          </div>
          <div>
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Próximo</button>
            ) : (
              <button className="btn btn-primary" disabled={saving} onClick={submit}>
                {saving ? "Criando..." : "Criar Agente"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
