"use client";
import { useState } from "react";
import { relativeTime, cn } from "../lib/utils";
import styles from "./sessions.module.css";
import SendBox from "./SendBox";
import {
  effectiveView,
  cleanOutput,
  projectName,
  whatsHappening,
  latestActionFor,
  type TmuxPane,
  type TmuxAction,
  type PaneView,
} from "./lib";

const WAITING_ALERT_MS = 10 * 60 * 1000;
const SENDABLE_STATES = ["claude_waiting_input", "claude_idle"];
const GATE_HINT = "gate do coletor só aceita waiting/idle";

const STATE_META: Record<string, { label: string; badge: string; pulse?: boolean }> = {
  claude_working: { label: "working", badge: styles.badgeWorking, pulse: true },
  claude_waiting_input: { label: "waiting input", badge: styles.badgeWaiting },
  claude_idle: { label: "idle", badge: styles.badgeIdle },
  shell: { label: "shell", badge: styles.badgeShell },
};

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
  return `esperando desde ${time}`;
}

interface PaneCardProps {
  pane: TmuxPane;
  actions: TmuxAction[];
  highlight?: boolean;
  defaultExpanded?: boolean;
}

export default function PaneCard({ pane, actions, highlight, defaultExpanded }: PaneCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const view = effectiveView(pane);
  const meta = STATE_META[view.state] ?? STATE_META.shell;
  const proj = projectName(pane.cwd);
  const doing = whatsHappening(pane);
  const preview = cleanOutput(pane.last_output, expanded ? 40 : 3);
  const sendable = SENDABLE_STATES.includes(view.state);
  const techId = `${pane.session} ${pane.window_index}.${pane.pane_index}${
    pane.window_name ? ` ${pane.window_name}` : ""
  }`;

  return (
    <div className={cn(styles.card, highlight && styles.cardWaiting)}>
      <div className={styles.cardTop}>
        <span className={cn(styles.badge, meta.badge)} title={`fonte: ${view.source}`}>
          <span className={cn(styles.dot, meta.pulse && styles.dotPulse)} />
          {meta.label}
        </span>
        {proj && <span className={styles.projTag}>{proj}</span>}
        <span className={cn(styles.badge, styles.badgeShell)}>{pane.host}</span>
        {pane.attached && <span className={cn(styles.badge, styles.badgeShell)}>attached</span>}
      </div>

      {doing && <div className={styles.cardDoing}>{doing}</div>}

      {preview.length > 0 && (
        <div
          className={cn(styles.preview, expanded && styles.previewExpanded)}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Clique para recolher" : "Clique para expandir"}
        >
          {preview.join("\n")}
        </div>
      )}

      <div className={styles.cardFoot}>
        <span className={cn(styles.stateTime, isWaitingTooLong(view) && styles.waitingLong)}>
          {view.state === "claude_waiting_input"
            ? waitingSinceLabel(view)
            : relativeTime(view.since)}
        </span>
        <span className={styles.techId}>{techId}</span>
      </div>

      {expanded && (
        <div className={styles.cardExpand}>
          {pane.cwd && <span className={styles.paneCwd}>{pane.cwd}</span>}
          {pane.command && <span className="mono-sm">{pane.command}</span>}
          <SendBox
            pane={pane}
            enabled={sendable}
            disabledReason={sendable ? undefined : `agente está ${meta.label} — ${GATE_HINT}`}
            lastAction={latestActionFor(pane, actions)}
          />
        </div>
      )}
    </div>
  );
}
