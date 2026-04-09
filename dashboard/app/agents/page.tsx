"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { SkeletonCards } from "../components/Skeleton";
import type { AgentSummary } from "../lib/types";
import { FilterSection, FilterSidebar } from "../components/FilterSection";
import type { FilterOption } from "../components/FilterSection";
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
  const [layerFilter, setLayerFilter] = useState<Set<string>>(new Set());

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
      setError("Erro de conexao");
    }
    setCreating(false);
  };

  const scheduleLabels: Record<string, string> = {
    alive: "Alive",
    "handoff-only": "Handoff-only",
    disabled: "Disabled",
  };

  const scheduleOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    agents.forEach((a) => { counts[a.schedule_mode] = (counts[a.schedule_mode] || 0) + 1; });
    return ["alive", "handoff-only", "disabled"].map((mode) => ({
      value: mode,
      label: scheduleLabels[mode],
      count: counts[mode] || 0,
    }));
  }, [agents]);

  const domainOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    agents.forEach((a) => { (a.domain || []).forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; }); });
    return Object.entries(counts).map(([d, count]) => ({ value: d, label: d, count }));
  }, [agents]);

  const modelOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    agents.forEach((a) => { if (a.model) counts[a.model] = (counts[a.model] || 0) + 1; });
    return Object.entries(counts).map(([m, count]) => ({ value: m, label: m, count }));
  }, [agents]);

  const layerOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    agents.forEach((a) => { if (a.layer) counts[a.layer] = (counts[a.layer] || 0) + 1; });
    return Object.entries(counts).map(([l, count]) => ({ value: l, label: l, count }));
  }, [agents]);

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

    if (layerFilter.size > 0) {
      result = result.filter((a) => layerFilter.has(a.layer));
    }

    return result;
  }, [agents, search, scheduleFilter, domainFilter, modelFilter, layerFilter]);

  function toggleSet(set: Set<string>, val: string): Set<string> {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  }

  return (
    <div className={styles.wrapper}>
      <div className="page-header">
        <h1 className="page-title">Agentes</h1>
      </div>

      <div className={styles.desktopLayout}>
        <FilterSidebar mobileLabel="Filtros">
          <input
            className={styles.searchInput}
            placeholder="Buscar agente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <FilterSection
            title="Schedule Mode"
            options={scheduleOptions}
            selected={scheduleFilter}
            onToggle={(v) => setScheduleFilter(toggleSet(scheduleFilter, v))}
          />

          {domainOptions.length > 0 && (
            <FilterSection
              title="Dominio"
              options={domainOptions}
              selected={domainFilter}
              onToggle={(v) => setDomainFilter(toggleSet(domainFilter, v))}
            />
          )}

          {modelOptions.length > 0 && (
            <FilterSection
              title="Modelo"
              options={modelOptions}
              selected={modelFilter}
              onToggle={(v) => setModelFilter(toggleSet(modelFilter, v))}
            />
          )}

          {layerOptions.length > 0 && (
            <FilterSection
              title="Layer"
              options={layerOptions}
              selected={layerFilter}
              onToggle={(v) => setLayerFilter(toggleSet(layerFilter, v))}
            />
          )}
        </FilterSidebar>

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
                <label className="form-label">Dominio</label>
                <input
                  className="input"
                  placeholder="ex: Financas, Saude..."
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
