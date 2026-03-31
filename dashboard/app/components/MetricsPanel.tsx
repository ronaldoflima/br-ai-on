"use client";
import { useEffect, useState } from "react";
import type { DayMetrics } from "../lib/types";
import { Sparkline } from "./Sparkline";

interface HistoryEntry {
  date: string;
  requests: number;
  success: number;
  errors: number;
  avg_latency_ms: number;
}

function MetricBox({ label, value, unit, color, sparkData, sparkColor }: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  sparkData?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "12px 16px" }}>
      <div className="text-muted-xs mb-sm">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "var(--text-primary)" }}>
        {value}
        {unit && <span className="text-muted-xs" style={{ marginLeft: 2 }}>{unit}</span>}
      </div>
      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
          <Sparkline data={sparkData} width={100} height={24} color={sparkColor || color || "var(--accent)"} />
        </div>
      )}
    </div>
  );
}

export function MetricsPanel({ metrics }: { metrics: DayMetrics }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/metrics/history?days=7")
      .then((r) => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => {});
  }, []);

  const successRate = metrics.total_requests > 0
    ? ((metrics.success / metrics.total_requests) * 100).toFixed(1)
    : "0";

  return (
    <div>
      <h2 className="section-title">Hoje</h2>
      <div className="grid grid-5">
        <MetricBox
          label="Requests"
          value={metrics.total_requests}
          sparkData={history.map((h) => h.requests)}
          sparkColor="var(--accent)"
        />
        <MetricBox
          label="Taxa Sucesso"
          value={`${successRate}%`}
          color={Number(successRate) >= 90 ? "var(--success)" : "var(--warning)"}
          sparkData={history.map((h) => h.requests > 0 ? (h.success / h.requests) * 100 : 0)}
          sparkColor="var(--success)"
        />
        <MetricBox
          label="Erros"
          value={metrics.errors}
          color={metrics.errors > 0 ? "var(--error)" : "var(--success)"}
          sparkData={history.map((h) => h.errors)}
          sparkColor="var(--error)"
        />
        <MetricBox
          label="Latência Avg"
          value={Math.round(metrics.avg_latency_ms || 0)}
          unit="ms"
          sparkData={history.map((h) => h.avg_latency_ms)}
          sparkColor="var(--accent)"
        />
      </div>
    </div>
  );
}
