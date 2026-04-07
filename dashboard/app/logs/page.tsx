"use client";
import { Fragment, useEffect, useState } from "react";
import type { LogEntry } from "../lib/types";
import { useAgentList } from "../lib/useAgentList";
import { formatTimestamp } from "../lib/utils";

export default function LogsPage() {
  const agents = useAgentList();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [agent, setAgent] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(0);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agent) params.set("agent", agent);
      params.set("date", date);
      params.set("limit", "200");
      const res = await fetch(`/api/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [agent, date]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, autoRefresh * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, agent, date]);

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.message?.toLowerCase().includes(s) ||
      e.action?.toLowerCase().includes(s) ||
      e.agent?.toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Logs</h1>
        <span className="text-muted-sm">{filtered.length} entradas</span>
      </div>

      <div className="filters">
        <select className="select" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Todos os agentes</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" value={autoRefresh} onChange={(e) => setAutoRefresh(Number(e.target.value))}>
          <option value={0}>Auto-refresh: off</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
        </select>
        <button className="btn" onClick={fetchLogs} disabled={loading}>{loading ? "..." : "Atualizar"}</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">Nenhum log encontrado</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Agente</th>
              <th>Ação</th>
              <th>Mensagem</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <Fragment key={i}>
                <tr
                  className={entry.status === "success" ? "log-row-success" : entry.status === "error" ? "log-row-error" : ""}
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  style={{ cursor: entry.metadata ? "pointer" : "default" }}
                >
                  <td className="mono-sm nowrap">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td><span className="badge badge-info">{entry.agent}</span></td>
                  <td className="mono-sm">{entry.action}</td>
                  <td style={{ maxWidth: 400 }}>{entry.message}</td>
                  <td>
                    <span className={`badge ${entry.status === "success" ? "badge-success" : entry.status === "error" ? "badge-error" : "badge-muted"}`}>
                      {entry.status}
                    </span>
                  </td>
                </tr>
                {expanded === i && entry.metadata && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--bg-input)", padding: 12 }}>
                      <table className="metadata-table">
                        <tbody>
                          {Object.entries(entry.metadata).map(([key, value]) => (
                            <tr key={key}>
                              <td className="metadata-key">{key}</td>
                              <td className="metadata-value">
                                {typeof value === "object" ? JSON.stringify(value) : String(value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
