"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { AgentDetail, EpisodicEntry, ConfigError } from "../../lib/types";
import { relativeTime } from "../../lib/utils";
import { renderMarkdown } from "../../lib/markdown";
import { ProgressBar } from "../../components/ProgressBar";

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const name = params.name as string;
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useState<"overview" | "config" | "soul" | "memory" | "terminal">("overview");
  const [memoryTab, setMemoryTab] = useState<"semantic" | "episodic">("semantic");
  const [configText, setConfigText] = useState("");
  const [soulText, setSoulText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [configErrors, setConfigErrors] = useState<ConfigError[]>([]);
  const [terminalSessions, setTerminalSessions] = useState<{ session: string; output: string }[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [handoffForm, setHandoffForm] = useState({ expects: "action", description: "", context: "", expected: "" });
  const [handoffSending, setHandoffSending] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState("");

  useEffect(() => {
    fetch(`/api/agents/${name}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: AgentDetail) => {
        setAgent(data);
        setConfigText(data.configRaw);
        setSoulText(data.soul);
      })
      .catch(() => router.push("/agents"));
  }, [name, router]);

  const fetchTerminal = async () => {
    setTerminalLoading(true);
    try {
      const res = await fetch(`/api/agents/${name}/terminal`);
      const data = await res.json();
      setTerminalSessions(data.sessions || []);
    } catch {
      setTerminalSessions([]);
    }
    setTerminalLoading(false);
  };

  const validateConfig = async (text: string) => {
    try {
      const res = await fetch(`/api/agents/${name}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: text }),
      });
      const data = await res.json();
      setConfigErrors(data.errors || []);
      return data.valid as boolean;
    } catch {
      return true;
    }
  };

  const save = async (field: "config" | "soul") => {
    if (field === "config") {
      const valid = await validateConfig(configText);
      if (!valid) return;
    }
    setSaving(true);
    setSaveStatus("");
    try {
      const body: Record<string, string> = {};
      if (field === "config") body.config = configText;
      if (field === "soul") body.soul = soulText;
      const res = await fetch(`/api/agents/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaveStatus("Salvo!");
        setConfigErrors([]);
      } else {
        const data = await res.json();
        if (data.errors) setConfigErrors(data.errors);
        setSaveStatus("Erro ao salvar");
      }
    } catch {
      setSaveStatus("Erro de conexão");
    }
    setSaving(false);
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const sendHandoff = async () => {
    setHandoffSending(true);
    setHandoffStatus("");
    try {
      const res = await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: name, ...handoffForm }),
      });
      if (res.ok) {
        setHandoffStatus("Enviado!");
        setHandoffForm({ expects: "action", description: "", context: "", expected: "" });
        setTimeout(() => { setShowHandoffModal(false); setHandoffStatus(""); }, 1200);
      } else {
        const data = await res.json();
        setHandoffStatus(data.error || "Erro ao enviar");
      }
    } catch {
      setHandoffStatus("Erro de conexão");
    }
    setHandoffSending(false);
  };

  const deleteAgent = async () => {
    if (!confirm(`Excluir o agente "${name}" permanentemente? Esta ação não pode ser desfeita.`)) return;
    const res = await fetch(`/api/agents/${name}`, { method: "DELETE" });
    if (res.ok) router.push("/agents");
  };

  if (!agent) return <div className="empty-state">Carregando...</div>;

  const config = agent.config as Record<string, unknown>;
  const heartbeat = (agent.heartbeat || {}) as Record<string, string>;
  const budget = (config.budget || {}) as Record<string, number>;
  const integrations = (config.integrations || {}) as Record<string, unknown>;
  const enabledIntegrations = Object.entries(integrations)
    .filter(([, v]) => v && typeof v === "object" && (v as Record<string, boolean>).enabled !== false)
    .map(([k]) => k);

  const importanceBadge = (importance: number) => {
    if (importance >= 4) return "badge-warning";
    if (importance >= 3) return "badge-success";
    if (importance >= 2) return "badge-info";
    return "badge-muted";
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{(config.display_name as string) || name}</h1>
          <span className="text-muted-sm">
            {config.domain as string} — v{config.version as string}
          </span>
        </div>
        <div className="flex-row">
          {saveStatus && (
            <span className="text-muted-sm" style={{ color: saveStatus === "Salvo!" ? "var(--success)" : "var(--error)" }}>
              {saveStatus}
            </span>
          )}
          <button className="btn" onClick={() => router.push(`/logs?agent=${name}`)}>Ver Logs</button>
          <button className="btn btn-primary" onClick={() => setShowHandoffModal(true)}>Novo Handoff</button>
          <button className="btn" style={{ color: "var(--error)", borderColor: "var(--error)" }} onClick={deleteAgent}>Excluir</button>
        </div>
      </div>

      <div className="tabs">
        {(["overview", "config", "soul", "memory", "terminal"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => {
            setTab(t);
            if (t === "terminal") fetchTerminal();
          }}>
            {t === "overview" ? "Overview" : t === "config" ? "Config" : t === "soul" ? "IDENTITY" : t === "memory" ? "Memória" : "Terminal"}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Heartbeat */}
          <div className="card">
            <h3 className="subsection-title">Heartbeat</h3>
            <div className="flex-row mb-md">
              <span className={`status-dot ${heartbeat.status === "started" ? "running" : heartbeat.status === "completed" ? "idle" : "error"}`} />
              <span className="text-secondary-sm font-semibold">
                {heartbeat.status || "desconhecido"}
              </span>
            </div>
            <div className="text-muted-sm">
              Último ping: {relativeTime(heartbeat.last_ping || null)}
            </div>
            {heartbeat.last_ping && (
              <div className="text-muted-xs mt-sm">
                {new Date(heartbeat.last_ping).toLocaleString("pt-BR")}
              </div>
            )}
          </div>

          {/* Budget */}
          <div className="card">
            <h3 className="subsection-title">Budget</h3>
            {budget.max_tokens_per_session ? (
              <ProgressBar
                label="Tokens/Sessão"
                value={0}
                max={budget.max_tokens_per_session}
                showPercentage={false}
              />
            ) : null}
            {budget.max_sessions_per_day ? (
              <div className="text-muted-xs mt-sm">
                Máx sessões/dia: {budget.max_sessions_per_day}
              </div>
            ) : (
              <div className="text-muted-xs">Sem budget configurado</div>
            )}
          </div>

          {/* Objetivo */}
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3 className="subsection-title">Objetivo Atual</h3>
            <pre className="mono-sm text-secondary-sm pre-wrap">{agent.objective || "(nenhum)"}</pre>
          </div>

          {/* Integrações */}
          {enabledIntegrations.length > 0 && (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <h3 className="subsection-title">Integrações</h3>
              <div className="flex-row" style={{ flexWrap: "wrap", gap: 6 }}>
                {enabledIntegrations.map((name) => (
                  <span key={name} className="badge badge-info">{name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Decisões */}
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3 className="subsection-title">Decisões Recentes</h3>
            <pre className="mono-sm text-secondary-sm pre-wrap max-h-300">{agent.decisions || "(nenhuma)"}</pre>
          </div>
        </div>
      )}

      {tab === "config" && (
        <div>
          <textarea
            className="textarea"
            value={configText}
            onChange={(e) => { setConfigText(e.target.value); setConfigErrors([]); }}
            style={{ minHeight: 500, borderColor: configErrors.length > 0 ? "var(--error)" : undefined }}
            spellCheck={false}
          />
          {configErrors.length > 0 && (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "var(--error)15", border: "1px solid var(--error)40", borderRadius: 6 }}>
              {configErrors.map((e, i) => (
                <div key={i} style={{ fontSize: 13, color: "var(--error)", marginBottom: i < configErrors.length - 1 ? 4 : 0 }}>
                  <span style={{ fontWeight: 600 }}>{e.field}:</span> {e.message}
                </div>
              ))}
            </div>
          )}
          <div className="mt-md" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={() => save("config")} disabled={saving}>
              {saving ? "Salvando..." : "Salvar Config"}
            </button>
            <button className="btn" onClick={() => validateConfig(configText)} disabled={saving}>
              Validar
            </button>
            {configErrors.length === 0 && saveStatus === "" && configText !== agent?.configRaw && (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>não salvo</span>
            )}
          </div>
        </div>
      )}

      {tab === "soul" && (
        <div>
          <textarea className="textarea" value={soulText} onChange={(e) => setSoulText(e.target.value)} style={{ minHeight: 500 }} spellCheck={false} />
          <div className="mt-md">
            <button className="btn btn-primary" onClick={() => save("soul")} disabled={saving}>Salvar IDENTITY</button>
          </div>
        </div>
      )}

      {tab === "terminal" && (
        <div>
          <div className="flex-between mb-md">
            <span className="text-muted-sm">
              {terminalSessions.length === 0 && !terminalLoading ? "Nenhuma sessão tmux ativa" : `${terminalSessions.length} sessão(ões) ativa(s)`}
            </span>
            <button className="btn" onClick={fetchTerminal} disabled={terminalLoading}>
              {terminalLoading ? "Carregando..." : "Atualizar"}
            </button>
          </div>
          {terminalSessions.length === 0 && !terminalLoading ? (
            <div className="empty-state">Nenhuma sessão tmux ativa para este agente</div>
          ) : (
            <div className="flex-col">
              {terminalSessions.map(({ session, output }) => (
                <div key={session} className="card">
                  <div className="flex-between mb-sm">
                    <span className="mono-sm badge badge-info">{session}</span>
                  </div>
                  <pre className="mono-sm pre-wrap" style={{ maxHeight: 500, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>{output || "(sem output)"}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showHandoffModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "100%", maxWidth: 520, padding: 24 }}>
            <div className="flex-between mb-md">
              <h3 className="subsection-title" style={{ margin: 0 }}>Novo Handoff → {name}</h3>
              <button className="btn" onClick={() => { setShowHandoffModal(false); setHandoffStatus(""); }}>✕</button>
            </div>
            <div className="flex-col" style={{ gap: 12 }}>
              <div>
                <label className="text-muted-sm">Expects</label>
                <select
                  className="textarea"
                  style={{ minHeight: "unset", padding: "6px 10px" }}
                  value={handoffForm.expects}
                  onChange={(e) => setHandoffForm((f) => ({ ...f, expects: e.target.value }))}
                >
                  <option value="action">action</option>
                  <option value="review">review</option>
                  <option value="info">info</option>
                </select>
              </div>
              <div>
                <label className="text-muted-sm">Descrição</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 60 }}
                  value={handoffForm.description}
                  onChange={(e) => setHandoffForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="O que este handoff solicita?"
                />
              </div>
              <div>
                <label className="text-muted-sm">Contexto</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 60 }}
                  value={handoffForm.context}
                  onChange={(e) => setHandoffForm((f) => ({ ...f, context: e.target.value }))}
                  placeholder="Contexto adicional..."
                />
              </div>
              <div>
                <label className="text-muted-sm">Esperado</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 60 }}
                  value={handoffForm.expected}
                  onChange={(e) => setHandoffForm((f) => ({ ...f, expected: e.target.value }))}
                  placeholder="Resultado esperado..."
                />
              </div>
              <div className="flex-row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                {handoffStatus && (
                  <span className="text-muted-sm" style={{ color: handoffStatus === "Enviado!" ? "var(--success)" : "var(--error)" }}>
                    {handoffStatus}
                  </span>
                )}
                <button className="btn" onClick={() => { setShowHandoffModal(false); setHandoffStatus(""); }}>Cancelar</button>
                <button className="btn btn-primary" onClick={sendHandoff} disabled={handoffSending || !handoffForm.description.trim()}>
                  {handoffSending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "memory" && (
        <div>
          <div className="tabs">
            <button className={`tab ${memoryTab === "semantic" ? "active" : ""}`} onClick={() => setMemoryTab("semantic")}>
              Semântica
            </button>
            <button className={`tab ${memoryTab === "episodic" ? "active" : ""}`} onClick={() => setMemoryTab("episodic")}>
              Episódica ({agent.episodic?.length || 0})
            </button>
          </div>

          {memoryTab === "semantic" && (
            <div className="card">
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(agent.semantic || "(vazio)") }}
              />
            </div>
          )}

          {memoryTab === "episodic" && (
            <div className="flex-col">
              {(!agent.episodic || agent.episodic.length === 0) ? (
                <div className="empty-state">Nenhuma memória episódica</div>
              ) : (
                agent.episodic.map((entry: EpisodicEntry, i: number) => (
                  <div key={i} className="card">
                    <div className="flex-between mb-sm">
                      <div className="flex-row">
                        <span className="mono-sm nowrap">{entry.timestamp ? new Date(entry.timestamp).toLocaleString("pt-BR") : entry.date}</span>
                        <span className="badge badge-info">{entry.action}</span>
                      </div>
                      <span className={`badge ${importanceBadge(entry.importance)}`}>
                        imp: {entry.importance}
                      </span>
                    </div>
                    <div className="text-secondary-sm">{entry.context}</div>
                    {entry.outcome && (
                      <div className="text-muted-xs mt-sm">{entry.outcome}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
