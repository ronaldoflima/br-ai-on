"use client";
import { useEffect, useMemo, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { relativeTime, cn } from "../lib/utils";
import styles from "./sessions.module.css";

interface TmuxPane {
  host: string;
  session: string;
  window_index: number;
  pane_index: number;
  window_name: string | null;
  command: string | null;
  cwd: string | null;
  state: string;
  state_detail: string | null;
  last_output: string | null;
  attached: boolean;
  state_since: string;
  last_seen: string;
  hook_state?: string | null;
  hook_detail?: string | null;
  hook_event?: string | null;
  hook_event_at?: string | null;
}

// Visão efetiva do pane: o hook (preciso, evento de ciclo de vida do Claude
// Code) ganha da heurística quando é mais recente que a última transição
// observada pelo coletor; senão a heurística segue como rede de segurança.
interface PaneView {
  state: string;
  since: string;
  detail: string | null;
  source: "hook" | "heurística";
}

function effectiveView(p: TmuxPane): PaneView {
  const hookWins =
    p.hook_state &&
    p.hook_event_at &&
    new Date(p.hook_event_at).getTime() >= new Date(p.state_since).getTime();
  return hookWins
    ? { state: p.hook_state!, since: p.hook_event_at!, detail: p.hook_detail ?? null, source: "hook" }
    : { state: p.state, since: p.state_since, detail: p.state_detail, source: "heurística" };
}

interface HostStatus {
  host: string;
  last_run: string;
  online: boolean;
}

const KNOWN_HOSTS = ["mac", "vps-mcpgw", "vps-pessoal"];
const POLL_MS = 15000;
const WAITING_ALERT_MS = 10 * 60 * 1000;

const STATE_META: Record<string, { label: string; badge: string; pulse?: boolean }> = {
  claude_working: { label: "working", badge: styles.badgeWorking, pulse: true },
  claude_waiting_input: { label: "waiting input", badge: styles.badgeWaiting },
  claude_idle: { label: "idle", badge: styles.badgeIdle },
  shell: { label: "shell", badge: styles.badgeShell },
};

function paneKey(p: TmuxPane): string {
  return `${p.host}:${p.session}:${p.window_index}.${p.pane_index}`;
}

function isWaitingTooLong(view: PaneView): boolean {
  return (
    view.state === "claude_waiting_input" &&
    Date.now() - new Date(view.since).getTime() > WAITING_ALERT_MS
  );
}

function waitingSinceLabel(view: PaneView): string {
  const time = new Date(view.since).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return view.detail ? `esperando desde ${time} — ${view.detail}` : `esperando desde ${time}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<TmuxPane[]>([]);
  const [hosts, setHosts] = useState<HostStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let controller: AbortController | null = null;
    const fetchSessions = () => {
      // Aborta o fetch anterior ainda em andamento antes de iniciar outro.
      controller?.abort();
      controller = new AbortController();
      fetch("/api/sessions", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setSessions(data.sessions || []);
          setHosts(data.hosts || []);
          setError(data.error || "");
          setLoading(false);
        })
        .catch((err) => {
          // Abort não é erro: ou o intervalo disparou de novo, ou desmontou.
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

  const byHost = useMemo(() => {
    const map = new Map<string, Map<string, TmuxPane[]>>();
    for (const pane of sessions) {
      if (!map.has(pane.host)) map.set(pane.host, new Map());
      const hostSessions = map.get(pane.host)!;
      if (!hostSessions.has(pane.session)) hostSessions.set(pane.session, []);
      hostSessions.get(pane.session)!.push(pane);
    }
    return map;
  }, [sessions]);

  const hostStatus = useMemo(
    () => new Map(hosts.map((h) => [h.host, h])),
    [hosts],
  );

  const togglePreview = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Sessões tmux</h1>
        <span className="text-muted-xs">atualiza a cada 15s</span>
      </div>

      {error && <div className={cn(styles.errorBox, "mb-md")}>{error}</div>}

      {loading ? (
        <SkeletonCards count={6} />
      ) : (
        <div className={styles.wrapper}>
          {hostList.map((host) => {
            const hostSessions = byHost.get(host);
            const status = hostStatus.get(host);
            const offline = !status || !status.online;
            return (
              <section
                key={host}
                className={cn(styles.hostSection, offline && styles.hostOffline)}
              >
                <div className={styles.hostHeader}>
                  <span className={styles.hostName}>{host}</span>
                  {offline ? (
                    <span className={cn(styles.badge, styles.badgeWaiting)}>offline</span>
                  ) : (
                    <span className={cn(styles.badge, styles.badgeWorking)}>
                      <span className={styles.dot} />online
                    </span>
                  )}
                  {status && (
                    <span className={styles.hostMeta}>
                      coletor rodou {relativeTime(status.last_run)}
                    </span>
                  )}
                </div>

                {!hostSessions || hostSessions.size === 0 ? (
                  <div className={styles.emptyHost}>
                    {offline
                      ? "Host offline — sem dados do coletor."
                      : "Sem sessões tmux neste host."}
                  </div>
                ) : (
                  <div className={styles.sessionGrid}>
                    {[...hostSessions.entries()].map(([session, sessionPanes]) => (
                      <div key={session} className={styles.sessionCard}>
                        <div className={styles.sessionHeader}>
                          <span className={styles.sessionName}>{session}</span>
                          {sessionPanes.some((p) => p.attached) && (
                            <span className={cn(styles.badge, styles.badgeShell)}>attached</span>
                          )}
                        </div>

                        {sessionPanes.map((pane) => {
                          const key = paneKey(pane);
                          const view = effectiveView(pane);
                          const meta = STATE_META[view.state] || STATE_META.shell;
                          const alert = isWaitingTooLong(view);
                          const hookWaiting =
                            view.source === "hook" && view.state === "claude_waiting_input";
                          return (
                            <div
                              key={key}
                              className={cn(styles.paneRow, alert && styles.waitingAlert)}
                            >
                              <div className={styles.paneMeta}>
                                <span className={styles.paneId}>
                                  {pane.window_index}.{pane.pane_index}
                                  {pane.window_name ? ` ${pane.window_name}` : ""}
                                </span>
                                <span className={cn(styles.badge, meta.badge)}>
                                  <span className={cn(styles.dot, meta.pulse && styles.dotPulse)} />
                                  {meta.label}
                                </span>
                                <span className={styles.stateTime}>
                                  {relativeTime(view.since)}
                                </span>
                                {view.source === "hook" && (
                                  <span className={cn(styles.badge, styles.badgeHook)}>
                                    via hook
                                  </span>
                                )}
                                {pane.command && (
                                  <span className="mono-sm">{pane.command}</span>
                                )}
                              </div>
                              {hookWaiting ? (
                                <span className={styles.waitingSince}>
                                  {waitingSinceLabel(view)}
                                </span>
                              ) : (
                                view.detail && (
                                  <span className="text-muted-xs">{view.detail}</span>
                                )
                              )}
                              {pane.cwd && <span className={styles.paneCwd}>{pane.cwd}</span>}
                              {pane.last_output && (
                                <div
                                  className={cn(
                                    styles.preview,
                                    expanded.has(key) && styles.previewExpanded,
                                  )}
                                  onClick={() => togglePreview(key)}
                                  title={expanded.has(key) ? "Clique para recolher" : "Clique para expandir"}
                                >
                                  {pane.last_output}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
