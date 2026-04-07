"use client";
import { useEffect, useState, useCallback } from "react";

interface CronEntry {
  timestamp: string;
  message: string;
  level: string;
}

interface CronResponse {
  entries: CronEntry[];
  total: number;
  page: number;
  totalPages: number;
  fileSize?: number;
  lastModified?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  start: "badge-success",
  wrapup: "badge-info",
  error: "badge-error",
  paused: "badge-muted",
  skip: "badge-muted",
  handoff: "badge-info",
  scheduler: "badge-info",
  alive: "badge-success",
  obsidian: "badge-muted",
  cycle: "badge-muted",
  info: "badge-muted",
};

export default function CronLogsPage() {
  const [data, setData] = useState<CronResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "100");
      if (search) params.set("search", search);
      if (level) params.set("level", level);
      const res = await fetch(`/api/logs/cron?${params}`);
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [page, search, level]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, autoRefresh * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  const handleLevel = (val: string) => {
    setLevel(val);
    setPage(1);
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Cron Logs</h1>
        <span className="text-muted-sm">
          {data ? `${data.total} entradas` : "..."}
          {data?.fileSize ? ` \u00b7 ${formatSize(data.fileSize)}` : ""}
        </span>
      </div>

      <div className="filters">
        <input
          className="input"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <select className="select" value={level} onChange={(e) => handleLevel(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="start">START</option>
          <option value="wrapup">WRAPUP</option>
          <option value="handoff">Handoff</option>
          <option value="scheduler">Scheduler</option>
          <option value="alive">Alive</option>
          <option value="skip">SKIP</option>
          <option value="paused">PAUSED</option>
          <option value="error">ERROR</option>
          <option value="obsidian">Obsidian</option>
          <option value="cycle">Ciclo</option>
        </select>
        <select className="select" value={autoRefresh} onChange={(e) => setAutoRefresh(Number(e.target.value))}>
          <option value={0}>Auto-refresh: off</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
        </select>
        <button className="btn" onClick={fetchLogs} disabled={loading}>
          {loading ? "..." : "Atualizar"}
        </button>
      </div>

      {!data || data.entries.length === 0 ? (
        <div className="empty-state">Nenhum log encontrado</div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Tipo</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry, i) => (
                <tr key={`${entry.timestamp}-${i}`}>
                  <td className="mono-sm nowrap">{formatTime(entry.timestamp)}</td>
                  <td>
                    <span className={`badge ${LEVEL_COLORS[entry.level] || "badge-muted"}`}>
                      {entry.level}
                    </span>
                  </td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
              <button
                className="btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                &larr; Anterior
              </button>
              <span className="text-muted-sm">
                {page} / {data.totalPages}
              </span>
              <button
                className="btn"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Pr&oacute;xima &rarr;
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
