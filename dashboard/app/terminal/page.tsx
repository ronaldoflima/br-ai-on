"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import AnsiToHtml from "ansi-to-html";
import styles from "./terminal.module.css";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  activity: string | null;
}

const SPECIAL_KEYS: { label: string; key: string; title: string }[] = [
  { label: "Enter", key: "Enter", title: "Enter" },
  { label: "↑", key: "Up", title: "Seta cima" },
  { label: "↓", key: "Down", title: "Seta baixo" },
  { label: "←", key: "Left", title: "Seta esquerda" },
  { label: "→", key: "Right", title: "Seta direita" },
  { label: "Tab", key: "Tab", title: "Tab" },
  { label: "⇤Tab", key: "BTab", title: "Shift+Tab" },
  { label: "Ctrl+C", key: "C-c", title: "Ctrl+C (interromper)" },
  { label: "Ctrl+B", key: "C-b", title: "Ctrl+B (prefixo tmux)" },
  { label: "Ctrl+E", key: "C-e", title: "Ctrl+E" },
  { label: "Ctrl+T", key: "C-t", title: "Ctrl+T" },
  { label: "Esc", key: "Escape", title: "Escape" },
];

const ansiConverter = new AnsiToHtml({ fg: "#d4d4d4", bg: "#0d0d0d", escapeXML: true, stream: false });

export default function TerminalPage() {
  const isMobile = useIsMobile();
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sending, setSending] = useState(false);
  const [killing, setKilling] = useState(false);
  const [error, setError] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSessions = () => {
    fetch("/api/terminal")
      .then((r) => r.json())
      .then((data) => {
        setSessions(Array.isArray(data) ? data : []);
        setLoadingSessions(false);
      })
      .catch(() => setLoadingSessions(false));
  };

  const fetchOutput = useCallback(() => {
    if (!selected) return;
    fetch(`/api/terminal?session=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.output !== undefined) {
          setOutput(data.output);
        }
      })
      .catch(() => {});
  }, [selected]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selected) { setOutput(""); return; }
    fetchOutput();
    pollRef.current = setInterval(fetchOutput, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, fetchOutput]);

  const sendKeys = async () => {
    if (!selected || !input.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: selected, text: input }),
      });
      if (res.ok) {
        setInput("");
        setTimeout(fetchOutput, 500);
      } else {
        const d = await res.json();
        setError(d.error || "Erro ao enviar");
      }
    } catch {
      setError("Erro de conexão");
    }
    setSending(false);
  };

  const sendKey = useCallback(async (key: string) => {
    if (!selected || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: selected, key }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Erro ao enviar tecla");
      } else {
        setTimeout(fetchOutput, 300);
      }
    } catch {
      setError("Erro de conexão");
    }
    setSending(false);
  }, [selected, sending, fetchOutput]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.trim()) {
        sendKeys();
      } else {
        sendKey("Enter");
      }
    }
  };

  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLPreElement>) => {
    const arrowMap: Record<string, string> = {
      ArrowUp: "Up", ArrowDown: "Down",
      ArrowLeft: "Left", ArrowRight: "Right",
    };
    if (arrowMap[e.key]) {
      e.preventDefault();
      sendKey(arrowMap[e.key]);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      sendKey(e.shiftKey ? "BTab" : "Tab");
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      sendKey("Enter");
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      sendKey("Escape");
      return;
    }

    if (e.ctrlKey) {
      const ctrlMap: Record<string, string> = { b: "C-b", c: "C-c", e: "C-e", t: "C-t" };
      const tmuxKey = ctrlMap[e.key.toLowerCase()];
      if (tmuxKey) {
        e.preventDefault();
        sendKey(tmuxKey);
      }
    }
  };

  const createSession = async () => {
    const name = newSessionName.trim();
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/terminal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setNewSessionName("");
        setShowNewSession(false);
        fetchSessions();
        setSelected(name);
      } else {
        const d = await res.json();
        setError(d.error || "Erro ao criar sessão");
      }
    } catch {
      setError("Erro de conexão");
    }
    setCreating(false);
  };

  const killSession = async () => {
    if (!selected) return;
    setKilling(true);
    setError("");
    try {
      const res = await fetch(`/api/terminal?session=${encodeURIComponent(selected)}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((s) => s.filter((x) => x.name !== selected));
        setSelected(null);
        setOutput("");
      } else {
        const d = await res.json();
        setError(d.error || "Erro ao matar sessão");
      }
    } catch {
      setError("Erro de conexão");
    }
    setKilling(false);
  };

  const outputHtml = useMemo(() => {
    if (!output) return null;
    try { return ansiConverter.toHtml(output); } catch { return null; }
  }, [output]);

  const showSessionList = !isMobile || !selected;
  const showTerminal = !isMobile || !!selected;

  const sessionsList = (
    <div className={isMobile ? styles.sessionsListMobile : styles.sessionsList}>
      <div className={styles.sessionsHeader}>
        <span className={styles.sessionsLabel}>
          Sessões tmux
        </span>
        <button
          className={`btn ${styles.newSessionBtn}`}
          onClick={() => setShowNewSession((v) => !v)}
          title="Nova sessão"
        >
          +
        </button>
      </div>
      {showNewSession && (
        <div className={styles.newSessionRow}>
          <input
            className={`input ${styles.newSessionInput}`}
            placeholder="Nome da sessão"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createSession(); if (e.key === "Escape") setShowNewSession(false); }}
            autoFocus
          />
          <button
            className={`btn btn-primary ${styles.newSessionSubmit}`}
            onClick={createSession}
            disabled={creating || !newSessionName.trim()}
          >
            {creating ? "..." : "Criar"}
          </button>
        </div>
      )}
      {loadingSessions ? (
        <div className={styles.statusMsg}>Carregando...</div>
      ) : sessions.length === 0 ? (
        <div className={styles.statusMsg}>Nenhuma sessão ativa</div>
      ) : isMobile ? (
        <div className={styles.mobileChips}>
          {sessions.map((s) => (
            <button
              key={s.name}
              onClick={() => setSelected(s.name)}
              className={selected === s.name ? styles.mobileChipActive : styles.mobileChip}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : (
        sessions.map((s) => (
          <button
            key={s.name}
            onClick={() => setSelected(s.name)}
            className={selected === s.name ? styles.sessionItemActive : styles.sessionItem}
          >
            <span className={selected === s.name ? styles.sessionNameActive : styles.sessionName}>{s.name}</span>
            <span className={styles.sessionMeta}>
              {s.windows}w {s.attached ? "· anexada" : ""}
            </span>
          </button>
        ))
      )}
    </div>
  );

  const terminalPanel = selected ? (
    <div className={styles.terminalPanel}>
      <div className={styles.terminalToolbar}>
        {isMobile && (
          <button className={`btn ${styles.backBtn}`} onClick={() => setSelected(null)}>
            ← Sessões
          </button>
        )}
        <span className={styles.terminalTitle}>{selected}</span>
        <div className={styles.toolbarActions}>
          <button
            className={`btn ${styles.toolbarBtn}`}
            onClick={() => { setLoadingSessions(true); fetchSessions(); fetchOutput(); }}
          >
            Atualizar
          </button>
          <button
            className={`btn ${styles.killBtn}`}
            onClick={() => { if (window.confirm(`Matar a sessão "${selected}"?`)) killSession(); }}
            disabled={killing}
          >
            {killing ? "Matando..." : "Matar"}
          </button>
        </div>
      </div>

      <pre
        ref={outputRef}
        tabIndex={0}
        onKeyDown={handleTerminalKeyDown}
        className={isMobile ? styles.outputMobile : styles.output}
        dangerouslySetInnerHTML={outputHtml ? { __html: outputHtml } : undefined}
      >
        {outputHtml ? undefined : "Aguardando saída..."}
      </pre>

      {error && (
        <div className={styles.errorMsg}>{error}</div>
      )}

      <div className={styles.specialKeys}>
        {SPECIAL_KEYS.map(({ label, key, title }) => (
          <button
            key={key}
            className={`btn ${styles.specialKeyBtn}`}
            title={title}
            onClick={() => sendKey(key)}
            disabled={sending}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          className={`input ${styles.textInput}`}
          placeholder={isMobile ? "Digite e pressione Enviar..." : "Digite e pressione Enter para enviar..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          className={`btn btn-primary ${styles.sendBtn}`}
          onClick={sendKeys}
          disabled={sending || !input.trim()}
        >
          {sending ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  ) : !isMobile ? (
    <div className={styles.emptyState}>
      Selecione uma sessão
    </div>
  ) : null;

  return (
    <div className={styles.wrapper}>
      <div className={`page-header ${styles.header}`}>
        <h1 className="page-title">Terminais</h1>
      </div>

      {isMobile ? (
        <div className={styles.mobileLayout}>
          {showSessionList && sessionsList}
          {showTerminal && terminalPanel}
        </div>
      ) : (
        <div className={styles.desktopLayout}>
          {sessionsList}
          {terminalPanel}
        </div>
      )}
    </div>
  );
}
