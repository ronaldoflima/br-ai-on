"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { SkeletonCards } from "../components/Skeleton";
import type { AgentSummary } from "../lib/types";
import { getAvailableTags } from "../lib/domain";
import styles from "./agents.module.css";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", display_name: "", domain: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState<Set<string>>(new Set());

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

  const allAgentTags = useMemo(
    () => agents.map((a) => a.domain).filter((d) => d.length > 0),
    [agents]
  );

  const availableDomains = useMemo(
    () => getAvailableTags(allAgentTags, domainFilter),
    [allAgentTags, domainFilter]
  );

  const uniqueModels = useMemo(
    () => [...new Set(agents.map((a) => a.model).filter(Boolean))].sort(),
    [agents]
  );

  const filteredAgents = useMemo(() => {
    let result = agents;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.display_name.toLowerCase().includes(q)
      );
    }

    if (scheduleFilter.size > 0) {
      result = result.filter((a) => scheduleFilter.has(a.schedule_mode));
    }

    if (domainFilter.size > 0) {
      result = result.filter((a) =>
        a.domain.some((tag) => domainFilter.has(tag)),
      );
    }

    if (modelFilter.size > 0) {
      result = result.filter((a) => modelFilter.has(a.model));
    }

    return result;
  }, [agents, search, scheduleFilter, domainFilter, modelFilter]);

  function toggleSchedule(mode: string) {
    const next = new Set(scheduleFilter);
    if (next.has(mode)) next.delete(mode);
    else next.add(mode);
    setScheduleFilter(next);
  }

  function toggleDomain(domain: string) {
    const next = new Set(domainFilter);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    setDomainFilter(next);
  }

  function toggleModel(model: string) {
    const next = new Set(modelFilter);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    setModelFilter(next);
  }

  const scheduleLabels: Record<string, string> = {
    alive: "Alive",
    "handoff-only": "Handoff-only",
    disabled: "Disabled",
  };

  return (
    <div className={styles.wrapper}>
      <div className="page-header">
        <h1 className="page-title">Agentes</h1>
      </div>

      <div className={styles.desktopLayout}>
        <div className={styles.filterSidebar}>
          <input
            className={styles.searchInput}
            placeholder="Buscar agente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className={styles.sidebarLabel}>Schedule Mode</div>
          {(["alive", "handoff-only", "disabled"] as const).map((mode) => (
            <label key={mode} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={scheduleFilter.has(mode)}
                onChange={() => toggleSchedule(mode)}
              />
              {scheduleLabels[mode]}
            </label>
          ))}

          {availableDomains.length > 0 && (
            <>
              <div className={styles.sidebarLabel}>Domínio</div>
              {availableDomains.map((d) => (
                <label key={d} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={domainFilter.has(d)}
                    onChange={() => toggleDomain(d)}
                  />
                  {d}
                </label>
              ))}
            </>
          )}

          {uniqueModels.length > 0 && (
            <>
              <div className={styles.sidebarLabel}>Modelo</div>
              {uniqueModels.map((m) => (
                <label key={m} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={modelFilter.has(m)}
                    onChange={() => toggleModel(m)}
                  />
                  {m}
                </label>
              ))}
            </>
          )}
        </div>

        <div className={styles.mainPanel}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancelar" : "Novo Agente"}
            </button>
          </div>

          {showForm && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">Nome (slug)</label>
                <input
                  className="input"
                  placeholder="meu-agente"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  className="input"
                  placeholder="MeuAgente"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Domínio</label>
                <input
                  className="input"
                  placeholder="ex: Finanças, Saúde..."
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                />
              </div>
              {error && (
                <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              <button
                className="btn btn-primary"
                onClick={createAgent}
                disabled={creating || !form.name || !form.display_name}
              >
                {creating ? "Criando..." : "Criar Agente"}
              </button>
            </div>
          )}

          {loading ? (
            <SkeletonCards count={6} />
          ) : (
            <div className="grid grid-2">
              {filteredAgents.map((agent) => (
                <Link
                  key={agent.name}
                  href={`/agents/${agent.name}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="card pointer">
                    <div className="flex-between mb-sm">
                      <span className="font-semibold" style={{ fontSize: 15 }}>
                        {agent.display_name}
                      </span>
                      <span className="text-muted-xs">v{agent.version}</span>
                    </div>
                    <div className="text-secondary-sm mb-sm" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {agent.domain.map((tag) => (
                        <span key={tag} className="badge badge-muted" style={{ fontSize: 11 }}>{tag}</span>
                      ))}
                    </div>
                    <div className="flex-row" style={{ gap: 8 }}>
                      <span
                        className={`badge ${
                          agent.schedule_mode === "alive" ? "badge-success" : "badge-muted"
                        }`}
                      >
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
      </div>
    </div>
  );
}
