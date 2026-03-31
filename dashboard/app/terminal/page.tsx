"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import AnsiToHtml from "ansi-to-html";

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
    <div style={{
      width: isMobile ? "100%" : 220,
      flexShrink: 0,
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 8,
      overflowY: "auto",
      maxHeight: isMobile ? 180 : undefined,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 8px" }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
          Sessões tmux
        </span>
        <button
          className="btn"
          onClick={() => setShowNewSession((v) => !v)}
          style={{ fontSize: 10, padding: "2px 6px" }}
          title="Nova sessão"
        >
          +
        </button>
      </div>
      {showNewSession && (
        <div style={{ display: "flex", gap: 4, padding: "0 8px 8px", flexShrink: 0 }}>
          <input
            className="input"
            style={{ flex: 1, fontSize: 11, padding: "4px 6px" }}
            placeholder="Nome da sessão"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createSession(); if (e.key === "Escape") setShowNewSession(false); }}
            autoFocus
          />
          <button
            className="btn btn-primary"
            onClick={createSession}
            disabled={creating || !newSessionName.trim()}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            {creating ? "..." : "Criar"}
          </button>
        </div>
      )}
      {loadingSessions ? (
        <div style={{ padding: "8px", fontSize: 12, color: "var(--text-muted)" }}>Carregando...</div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: "8px", fontSize: 12, color: "var(--text-muted)" }}>Nenhuma sessão ativa</div>
      ) : isMobile ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sessions.map((s) => (
            <button
              key={s.name}
              onClick={() => setSelected(s.name)}
              style={{
                background: selected === s.name ? "var(--bg-hover)" : "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 12px",
                cursor: "pointer",
                color: selected === s.name ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 13,
                fontWeight: selected === s.name ? 600 : 400,
              }}
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
            style={{
              width: "100%",
              textAlign: "left",
              background: selected === s.name ? "var(--bg-hover)" : "transparent",
              border: "none",
              borderRadius: 6,
              padding: "8px 10px",
              cursor: "pointer",
              color: selected === s.name ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontWeight: selected === s.name ? 600 : 400 }}>{s.name}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {s.windows}w {s.attached ? "· anexada" : ""}
            </span>
          </button>
        ))
      )}
    </div>
  );

  const terminalPanel = selected ? (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
        {isMobile && (
          <button className="btn" onClick={() => setSelected(null)} style={{ fontSize: 11 }}>
            ← Sessões
          </button>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{selected}</span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button
            className="btn"
            onClick={() => { setLoadingSessions(true); fetchSessions(); fetchOutput(); }}
            style={{ fontSize: 11 }}
          >
            Atualizar
          </button>
          <button
            className="btn"
            onClick={() => { if (window.confirm(`Matar a sessão "${selected}"?`)) killSession(); }}
            disabled={killing}
            style={{ fontSize: 11, color: "var(--error)", borderColor: "var(--error)40" }}
          >
            {killing ? "Matando..." : "Matar"}
          </button>
        </div>
      </div>

      <pre
        ref={outputRef}
        tabIndex={0}
        onKeyDown={handleTerminalKeyDown}
        style={{
          flex: 1,
          background: "#0d0d0d",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 12,
          margin: 0,
          overflow: "auto",
          fontSize: isMobile ? 10 : 11,
          fontFamily: "monospace",
          lineHeight: 1.5,
          color: "#d4d4d4",
          whiteSpace: "pre",
          minHeight: 0,
          outline: "none",
          cursor: "default",
        }}
        dangerouslySetInnerHTML={outputHtml ? { __html: outputHtml } : undefined}
      >
        {outputHtml ? undefined : "Aguardando saída..."}
      </pre>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 12, marginTop: 6, flexShrink: 0 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {SPECIAL_KEYS.map(({ label, key, title }) => (
          <button
            key={key}
            className="btn"
            title={title}
            onClick={() => sendKey(key)}
            disabled={sending}
            style={{ fontSize: 11, padding: "4px 8px", minWidth: 0, fontFamily: "monospace" }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6, flexShrink: 0 }}>
        <input
          ref={inputRef}
          className="input"
          style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
          placeholder={isMobile ? "Digite e pressione Enviar..." : "Digite e pressione Enter para enviar..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          className="btn btn-primary"
          onClick={sendKeys}
          disabled={sending || !input.trim()}
          style={{ fontSize: 12, minWidth: 60 }}
        >
          {sending ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  ) : !isMobile ? (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
      Selecione uma sessão
    </div>
  ) : null;

  return (
    <div style={{ marginLeft: -24, marginRight: -24, marginTop: -24, padding: "16px 24px", display: "flex", flexDirection: "column", height: "100dvh", boxSizing: "border-box" }}>
      <div className="page-header" style={{ marginBottom: 12, flexShrink: 0 }}>
        <h1 className="page-title">Terminais</h1>
      </div>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
          {showSessionList && sessionsList}
          {showTerminal && terminalPanel}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
          {sessionsList}
          {terminalPanel}
        </div>
      )}
    </div>
  );
}
