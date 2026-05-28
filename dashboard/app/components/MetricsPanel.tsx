"use client";
import { useEffect, useState } from "react";
import type { DayMetrics, AgentStatus } from "../lib/types";
import { Sparkline } from "./Sparkline";

interface HistoryEntry {
  date: string;
  requests: number;
  sessions: number;
  handoffs: number;
  blocked: number;
}

function MetricBox({ label, value, sublabel, color, sparkData, sparkColor }: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
  sparkData?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "12px 16px" }}>
      <div className="text-muted-xs mb-sm">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "var(--text-primary)" }}>
        {value}
      </div>
      {sparkData && sparkData.length > 1 ? (
        <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
          <Sparkline data={sparkData} width={100} height={24} color={sparkColor || color || "var(--accent)"} />
        </div>
      ) : sublabel ? (
        <div className="text-muted-xs" style={{ marginTop: 6 }}>{sublabel}</div>
      ) : null}
    </div>
  );
}

export function MetricsPanel({ metrics, agents }: { metrics: DayMetrics; agents: AgentStatus[] }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/metrics/history?days=7")
      .then((r) => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => {});
  }, []);

  const healthy = agents.filter((a) => a.state === "running" || a.state === "idle").length;
  const unhealthy = agents.length - healthy;

  return (
    <div>
      <h2 className="section-title">Visão geral</h2>
      <div className="grid grid-5">
        <MetricBox
          label="Requests"
          value={metrics.total_requests}
          sparkData={history.map((h) => h.requests)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Sessões"
          value={metrics.sessions}
          sparkData={history.map((h) => h.sessions)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Handoffs"
          value={metrics.handoffs}
          sparkData={history.map((h) => h.handoffs)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Agentes ativos"
          value={`${healthy} / ${agents.length}`}
          sublabel="agora"
          color={unhealthy > 0 ? "var(--warning)" : "var(--success)"}
        />
        <MetricBox
          label="Bloqueios"
          value={metrics.blocked}
          color={metrics.blocked > 0 ? "var(--error)" : "var(--success)"}
          sparkData={history.map((h) => h.blocked)}
          sparkColor="var(--error)"
        />
      </div>
    </div>
  );
}
