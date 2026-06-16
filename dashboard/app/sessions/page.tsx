"use client";
import { useEffect, useMemo, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { relativeTime, cn } from "../lib/utils";
import styles from "./sessions.module.css";
import SendBox from "./SendBox";
import {
  effectiveView,
  cleanOutput,
  projectName,
  stateRank,
  latestActionFor,
  type TmuxPane,
  type TmuxAction,
  type PaneView,
} from "./lib";

interface HostStatus {
  host: string;
  last_run: string;
  online: boolean;
}

const KNOWN_HOSTS = ["mac", "vps-mcpgw", "vps-pessoal"];
const POLL_MS = 15000;
const WAITING_ALERT_MS = 10 * 60 * 1000;
// Estados em que o gate do coletor aceita send-keys (cortesia de UI; o gate
// autoritativo é o do coletor, por ciclo — pode divergir brevemente).
const SENDABLE_STATES = ["claude_waiting_input", "claude_idle"];
const GATE_HINT = "gate do coletor só aceita waiting/idle";

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

function paneTitle(p: TmuxPane): string {
  const proj = projectName(p.cwd);
  const id = `${p.window_index}.${p.pane_index}${p.window_name ? ` ${p.window_name}` : ""}`;
  return proj ? `${proj} · ${id}` : id;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<TmuxPane[]>([]);
  const [hosts, setHosts] = useState<HostStatus[]>([]);
  const [actions, setActions] = useState<TmuxAction[]>([]);
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
          setActions(data.actions || []);
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
    // Dentro de cada sessão: working → waiting → idle → shell; empate pela
    // transição mais recente.
    for (const hostSessions of map.values()) {
      for (const panes of hostSessions.values()) {
        panes.sort((a, b) => {
          const va = effectiveView(a);
          const vb = effectiveView(b);
          const rank = stateRank(va.state) - stateRank(vb.state);
          if (rank !== 0) return rank;
          return new Date(vb.since).getTime() - new Date(va.since).getTime();
        });
      }
    }
    return map;
  }, [sessions]);

  // Triagem: panes esperando input, espera mais longa primeiro.
  const waitingPanes = useMemo(
    () =>
      sessions
        .map((p) => ({ pane: p, view: effectiveView(p) }))
        .filter(({ view }) => view.state === "claude_waiting_input")
        .sort(
          (a, b) => new Date(a.view.since).getTime() - new Date(b.view.since).getTime(),
        ),
    [sessions],
  );

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
          <section className={styles.needsYou}>
            <h2 className={styles.needsYouTitle}>Precisa de você</h2>
            {waitingPanes.length === 0 ? (
              <div className={styles.allClear}>Nenhum agente precisa de você ✓</div>
            ) : (
              waitingPanes.map(({ pane, view }) => {
                const key = paneKey(pane);
                const previewKey = `needs:${key}`;
                const isOpen = expanded.has(previewKey);
                const lines = cleanOutput(pane.last_output, isOpen ? 40 : 6);
                return (
                  <div key={key} className={styles.needsYouCard}>
                    <div className={styles.paneMeta}>
                      {projectName(pane.cwd) && (
                        <span className={styles.projTag}>{projectName(pane.cwd)}</span>
                      )}
                      <span className={styles.paneId}>
                        {pane.session} {pane.window_index}.{pane.pane_index}
                        {pane.window_name ? ` ${pane.window_name}` : ""}
                      </span>
                      <span className={cn(styles.badge, styles.badgeShell)}>{pane.host}</span>
                      <span
                        className={cn(
                          styles.waitingSince,
                          isWaitingTooLong(view) && styles.waitingLong,
                        )}
                      >
                        {waitingSinceLabel(view)}
                      </span>
                    </div>
                    {lines.length > 0 && (
                      <div
                        className={cn(styles.preview, isOpen && styles.previewExpanded)}
                        onClick={() => togglePreview(previewKey)}
                        title={isOpen ? "Clique para recolher" : "Clique para expandir"}
                      >
                        {lines.join("\n")}
                      </div>
                    )}
                    <SendBox
                      pane={pane}
                      enabled
                      lastAction={latestActionFor(pane, actions)}
                    />
                  </div>
                );
              })
            )}
          </section>

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
                          const isOpen = expanded.has(key);
                          const sendable = SENDABLE_STATES.includes(view.state);
                          const detailLines = isOpen ? cleanOutput(pane.last_output, 40) : [];
                          return (
                            <div key={key} className={styles.paneItem}>
                              <div
                                className={cn(
                                  styles.paneLine,
                                  view.state === "claude_waiting_input" && styles.paneLineWaiting,
                                )}
                                onClick={() => togglePreview(key)}
                                title={isOpen ? "Clique para recolher" : "Clique para detalhes"}
                              >
                                <span className={styles.paneLineName}>{paneTitle(pane)}</span>
                                <span
                                  className={cn(styles.badge, meta.badge)}
                                  title={`fonte: ${view.source}`}
                                >
                                  <span className={cn(styles.dot, meta.pulse && styles.dotPulse)} />
                                  {meta.label}
                                </span>
                                <span className={styles.stateTime}>{relativeTime(view.since)}</span>
                              </div>
                              {isOpen && (
                                <div className={styles.paneDetail}>
                                  {pane.cwd && <span className={styles.paneCwd}>{pane.cwd}</span>}
                                  {pane.command && <span className="mono-sm">{pane.command}</span>}
                                  {view.detail && (
                                    <span className="text-muted-xs">{view.detail}</span>
                                  )}
                                  {detailLines.length > 0 && (
                                    <div className={cn(styles.preview, styles.previewExpanded)}>
                                      {detailLines.join("\n")}
                                    </div>
                                  )}
                                  <SendBox
                                    pane={pane}
                                    enabled={sendable}
                                    disabledReason={
                                      sendable ? undefined : `agente está ${meta.label} — ${GATE_HINT}`
                                    }
                                    lastAction={latestActionFor(pane, actions)}
                                  />
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
