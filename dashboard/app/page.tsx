"use client";
import { useEffect, useState } from "react";
import { AgentCard } from "./components/AgentCard";
import { MetricsPanel } from "./components/MetricsPanel";
import { SkeletonCards } from "./components/Skeleton";
import type { AgentStatus, DayMetrics } from "./lib/types";

export default function OverviewPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [metrics, setMetrics] = useState<DayMetrics | null>(null);
  const [lastUpdate, setLastUpdate] = useState("");
  const [loading, setLoading] = useState(true);
  const [metricsDate, setMetricsDate] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<"alive" | "handoff-only" | "all">("all");
  const [paused, setPaused] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);

  const fetchData = async () => {
    try {
      const metricsUrl = metricsDate === new Date().toISOString().slice(0, 10)
        ? "/api/metrics"
        : `/api/metrics?date=${metricsDate}`;
      const [statusRes, metricsRes, pauseRes] = await Promise.all([
        fetch("/api/status"),
        fetch(metricsUrl),
        fetch("/api/pause"),
      ]);
      if (statusRes.ok) setAgents(await statusRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (pauseRes.ok) setPaused((await pauseRes.json()).paused);
      setLastUpdate(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error("Fetch error:", e);
    }
    setLoading(false);
  };

  const togglePause = async () => {
    setPauseLoading(true);
    try {
      const res = await fetch("/api/pause", { method: paused ? "DELETE" : "POST" });
      if (res.ok) setPaused((await res.json()).paused);
    } catch {}
    setPauseLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [metricsDate]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <div className="flex-row">
          <input
            className="input"
            type="date"
            value={metricsDate}
            onChange={(e) => setMetricsDate(e.target.value)}
            style={{ width: "auto" }}
          />
          <span className="text-muted-sm" suppressHydrationWarning>
            {lastUpdate}
          </span>
          <button
            className="btn"
            onClick={togglePause}
            disabled={pauseLoading}
            style={{
              borderColor: paused ? "var(--success)" : "var(--error)",
              color: paused ? "var(--success)" : "var(--error)",
              minWidth: 110,
            }}
          >
            {pauseLoading ? "..." : paused ? "▶ Retomar" : "⏹ Pausar tudo"}
          </button>
        </div>
      </div>

      {paused && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--error)15", border: "1px solid var(--error)40", borderRadius: 6, fontSize: 13, color: "var(--error)" }}>
          Cron pausado — nenhum agente será iniciado até retomar.
        </div>
      )}

      {loading ? (
        <>
          <div className="grid grid-5" style={{ marginBottom: 24 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card skeleton" style={{ height: "70px" }} />
            ))}
          </div>
          <SkeletonCards count={6} />
        </>
      ) : (
        <>
          {metrics && <MetricsPanel metrics={metrics} />}

          <div className="flex-between mt-lg">
            <h2 className="section-title" style={{ margin: 0 }}>Agentes</h2>
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
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            {agents
              .filter((a) => {
                if (statusFilter === "alive") return a.scheduleMode === "alive";
                if (statusFilter === "handoff-only") return a.scheduleMode !== "alive";
                return true;
              })
              .map((agent) => (
                <AgentCard key={agent.name} agent={agent} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
