"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SkeletonCards } from "../components/Skeleton";
import type { AgentSummary } from "../lib/types";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"alive" | "handoff-only" | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", display_name: "", domain: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const fetchAgents = () => {
    setLoading(true);
    fetch("/api/agents")
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAgents(); }, []);

  const createAgent = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setForm({ name: "", display_name: "", domain: "" });
        fetchAgents();
      } else {
        const data = await res.json();
        setError(data.error || "Erro ao criar");
      }
    } catch {
      setError("Erro de conexão");
    }
    setCreating(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Agentes</h1>
        <div className="flex-row">
          {(["all", "alive", "handoff-only"] as const).map((f) => (
            <button
              key={f}
              className={`badge ${statusFilter === f ? "badge-info" : "badge-muted"} pointer`}
              onClick={() => setStatusFilter(f)}
            >
              {{ all: "Todos", alive: "Alive", "handoff-only": "Handoff-only" }[f]}
            </button>
          ))}
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancelar" : "Novo Agente"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-md" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">Nome (slug)</label>
            <input className="input" placeholder="meu-agente" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input className="input" placeholder="MeuAgente" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Domínio</label>
            <input className="input" placeholder="ex: Finanças, Saúde..." value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          </div>
          {error && <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <button className="btn btn-primary" onClick={createAgent} disabled={creating || !form.name || !form.display_name}>
            {creating ? "Criando..." : "Criar Agente"}
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonCards count={6} />
      ) : (
        <div className="grid grid-2">
          {agents.filter((a) => {
            if (statusFilter === "alive") return a.schedule_mode === "alive";
            if (statusFilter === "handoff-only") return a.schedule_mode === "handoff-only";
            return true;
          }).map((agent) => (
            <Link key={agent.name} href={`/agents/${agent.name}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card pointer">
                <div className="flex-between mb-sm">
                  <span className="font-semibold" style={{ fontSize: 15 }}>{agent.display_name}</span>
                  <span className="text-muted-xs">v{agent.version}</span>
                </div>
                <div className="text-secondary-sm mb-sm">{agent.domain}</div>
                <div className="flex-row" style={{ gap: 8 }}>
                  <span className={`badge ${agent.schedule_mode === "alive" ? "badge-success" : "badge-muted"}`}>
                    {agent.schedule_mode}
                  </span>
                  {agent.schedule_interval && (
                    <span className="text-muted-xs">{agent.schedule_interval}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
