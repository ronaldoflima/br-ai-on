"use client";
import { useState } from "react";
import { cn } from "../lib/utils";
import styles from "./sessions.module.css";
import type { TmuxPane, TmuxAction } from "./lib";

interface SendBoxProps {
  pane: TmuxPane;
  enabled: boolean;
  disabledReason?: string;
  lastAction?: TmuxAction;
  onSent?: () => void;
}

// Campo de envio de prompt para um pane via braion.tmux_actions. A entrega é
// do coletor do host (gate de estado autoritativo); o `enabled` daqui é só
// cortesia de UI — pode divergir brevemente do gate real.
export default function SendBox({ pane, enabled, disabledReason, lastAction, onSent }: SendBoxProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // id da action criada pelo ÚLTIMO envio deste SendBox: o feedback de status
  // só considera lastAction quando corresponde a um envio nosso desta sessão
  // de UI (evita mostrar "entregue" de um envio antigo ao abrir o painel).
  const [sentId, setSentId] = useState<number | null>(null);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/sessions/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: pane.host,
          session: pane.session,
          window_index: pane.window_index,
          pane_index: pane.pane_index,
          text: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return; // preserva o texto para retry
      }
      setSentId(data.id);
      setText("");
      onSent?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  const tracked = sentId !== null && lastAction?.id === sentId ? lastAction : null;
  const waitingDelivery = sentId !== null && (!tracked || tracked.status === "pending");

  let status: { cls: string; label: string } | null = null;
  if (error) {
    status = { cls: styles.sendStatusError, label: `erro: ${error}` };
  } else if (waitingDelivery) {
    status = { cls: styles.sendStatusPending, label: "enviado — aguardando entrega…" };
  } else if (tracked?.status === "done") {
    status = { cls: styles.sendStatusOk, label: "✓ entregue" };
  } else if (tracked && (tracked.status === "error" || tracked.status === "expired")) {
    status = {
      cls: styles.sendStatusError,
      label: `✗ ${tracked.status === "expired" ? "expirou" : "falhou"}${tracked.result ? ` — ${tracked.result}` : ""}`,
    };
  }

  return (
    <div className={styles.sendBox}>
      <div className={styles.sendRow}>
        <textarea
          className={styles.sendInput}
          rows={1}
          value={text}
          placeholder={enabled ? "responder…" : disabledReason || "envio indisponível"}
          disabled={!enabled || sending}
          title={!enabled ? disabledReason : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className={styles.sendBtn}
          disabled={!enabled || sending || !text.trim()}
          title={!enabled ? disabledReason : "enviar (⌘↵)"}
          onClick={send}
        >
          {sending ? "…" : "enviar"}
        </button>
      </div>
      {status && <span className={cn(styles.sendStatus, status.cls)}>{status.label}</span>}
    </div>
  );
}
