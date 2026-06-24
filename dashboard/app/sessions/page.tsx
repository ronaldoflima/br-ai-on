"use client";
import { useEffect, useMemo, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { cn } from "../lib/utils";
import styles from "./sessions.module.css";
import PaneCard from "./PaneCard";
import {
  effectiveView,
  isActiveState,
  matchesQuery,
  stateRank,
  type TmuxPane,
  type TmuxAction,
} from "./lib";

interface HostStatus {
  host: string;
  last_run: string;
  online: boolean;
}

const KNOWN_HOSTS = ["mac", "vps-mcpgw", "vps-pessoal"];
const POLL_MS = 15000;

function paneKey(p: TmuxPane): string {
  return `${p.host}:${p.session}:${p.window_index}.${p.pane_index}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<TmuxPane[]>([]);
  const [hosts, setHosts] = useState<HostStatus[]>([]);
  const [actions, setActions] = useState<TmuxAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [hiddenHosts, setHiddenHosts] = useState<Set<string>>(new Set());
  const [activeOnly, setActiveOnly] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;
    const fetchSessions = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/sessions", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setSessions(data.sessions || []);
          setHosts(data.hosts || []);
          setActions(data.actions || []);
          setError(data.error || "");
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Erro de conexão com a API");
          setLoading(false);
        });
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, POLL_MS);
    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const hostList = useMemo(() => {
    const extra = [...new Set([...sessions.map((p) => p.host), ...hosts.map((h) => h.host)])]
      .filter((h) => !KNOWN_HOSTS.includes(h))
      .sort();
    return [...KNOWN_HOSTS, ...extra];
  }, [sessions, hosts]);

  const hostStatus = useMemo(() => new Map(hosts.map((h) => [h.host, h])), [hosts]);

  const visible = useMemo(
    () =>
      sessions.filter(
        (p) =>
          matchesQuery(p, query) &&
          !hiddenHosts.has(p.host) &&
          (!activeOnly || isActiveState(effectiveView(p).state)),
      ),
    [sessions, query, hiddenHosts, activeOnly],
  );

  const feed = useMemo(
    () =>
      [...visible].sort((a, b) => {
        const va = effectiveView(a);
        const vb = effectiveView(b);
        const rank = stateRank(va.state) - stateRank(vb.state);
        if (rank !== 0) return rank;
        return new Date(vb.since).getTime() - new Date(va.since).getTime();
      }),
    [visible],
  );

  const waiting = useMemo(
    () =>
      visible
        .filter((p) => effectiveView(p).state === "claude_waiting_input")
        .sort(
          (a, b) =>
            new Date(effectiveView(a).since).getTime() -
            new Date(effectiveView(b).since).getTime(),
        ),
    [visible],
  );

  const onlineCount = hosts.filter((h) => h.online).length;

  const toggleHost = (host: string) => {
    setHiddenHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Sessões tmux</h1>
        <span className="text-muted-xs">
          {sessions.length} panes · {waiting.length} esperando · {onlineCount}/{hosts.length || hostList.length} hosts · atualiza 15s
        </span>
      </div>

      {error && <div className={cn(styles.errorBox, "mb-md")}>{error}</div>}

      {loading ? (
        <SkeletonCards count={6} />
      ) : (
        <div className={styles.wrapper}>
          <div className={styles.controlBar}>
            <input
              className={styles.searchInput}
              placeholder="buscar projeto, host, sessão…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.hostChips}>
              {hostList.map((host) => {
                const off = hiddenHosts.has(host);
                const offline = !hostStatus.get(host)?.online;
                return (
                  <button
                    key={host}
                    className={cn(styles.hostChip, off && styles.hostChipOff, offline && styles.hostChipOffline)}
                    onClick={() => toggleHost(host)}
                    title={offline ? "host offline" : off ? "mostrar host" : "ocultar host"}
                  >
                    {host}
                  </button>
                );
              })}
            </div>
            <button
              className={cn(styles.focusToggle, activeOnly && styles.focusToggleOn)}
              onClick={() => setActiveOnly((v) => !v)}
              title="Mostrar só working + waiting"
            >
              só ativos
            </button>
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Precisa de você ({waiting.length})</h2>
            {waiting.length === 0 ? (
              <div className={styles.allClear}>Nenhum agente precisa de você ✓</div>
            ) : (
              <div className={styles.grid}>
                {waiting.map((pane) => (
                  <PaneCard
                    key={paneKey(pane)}
                    pane={pane}
                    actions={actions}
                    highlight
                    defaultExpanded
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Todas as sessões ({feed.length})</h2>
            {feed.length === 0 ? (
              <div className={styles.allClear}>Nenhum pane corresponde aos filtros.</div>
            ) : (
              <div className={styles.grid}>
                {feed.map((pane) => (
                  <PaneCard key={paneKey(pane)} pane={pane} actions={actions} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
