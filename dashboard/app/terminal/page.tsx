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

const SPECIAL_KEYS: { label: string; key: string; ctrl?: boolean; title: string }[] = [
  { label: "Enter", key: "Enter", title: "Enter" },
  { label: "↑", key: "ArrowUp", title: "Seta cima" },
  { label: "↓", key: "ArrowDown", title: "Seta baixo" },
  { label: "←", key: "ArrowLeft", title: "Seta esquerda" },
  { label: "→", key: "ArrowRight", title: "Seta direita" },
  { label: "Tab", key: "Tab", title: "Tab" },
  { label: "⇤Tab", key: "Tab", title: "Shift+Tab" },
  { label: "Ctrl+C", key: "c", ctrl: true, title: "Ctrl+C (interromper)" },
  { label: "Ctrl+B", key: "b", ctrl: true, title: "Ctrl+B (prefixo tmux)" },
  { label: "Ctrl+E", key: "e", ctrl: true, title: "Ctrl+E" },
  { label: "Ctrl+T", key: "t", ctrl: true, title: "Ctrl+T" },
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
  const [directMode, setDirectMode] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [captureLines, setCaptureLines] = useState(() => {
    if (typeof window !== "undefined") return parseInt(localStorage.getItem("termCaptureLines") ?? "100") || 100;
    return 100;
  });
  const [refreshRate, setRefreshRate] = useState(() => {
    if (typeof window !== "undefined") return parseInt(localStorage.getItem("termRefreshRate") ?? "300") || 300;
    return 300;
  });
  const outputRef = useRef<HTMLPreElement>(null);
  const sseRef = useRef<EventSource | null>(null);
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

  const connectSSE = useCallback((session: string, lines: number, rate: number = 300) => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    const es = new EventSource(`/api/terminal/stream?session=${encodeURIComponent(session)}&lines=${lines}&rate=${rate}`);
    es.addEventListener("output", (e) => {
      try { setOutput(JSON.parse(e.data)); } catch {}
    });
    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };
    sseRef.current = es;
  }, []);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [output]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [vpHeight, setVpHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      setVpHeight(vv.height);
      window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    if (!isMobile || !selected) return;
    const html = document.documentElement;
    const body = document.body;
    const saved = { html: html.style.overflow, body: body.style.overflow };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = saved.html;
      body.style.overflow = saved.body;
    };
  }, [isMobile, selected]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selected) {
      setOutput("");
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      return;
    }
    connectSSE(selected, captureLines, refreshRate);
    return () => {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, [selected, captureLines, refreshRate, connectSSE]);

  useEffect(() => {
    if (isMobile && directMode) setDirectMode(false);
  }, [isMobile]);

  useEffect(() => {
    if (directMode && selected) {
      outputRef.current?.focus();
    } else if (!directMode && selected) {
      inputRef.current?.focus();
    }
  }, [directMode, selected]);

  const sendKey = useCallback(async (key: string, ctrl = false, meta = false, shift = false) => {
    if (!selected) return;
    try {
      await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: selected, key, ctrl, meta, shift }),
      });
    } catch {}
  }, [selected]);

  const sendText = async (text: string) => {
    if (!selected || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: selected, text }),
      });
      if (res.ok) {
        setInput("");
      } else {
        const d = await res.json();
        setError(d.error || "Erro ao enviar");
      }
    } catch {
      setError("Erro de conexão");
    }
    setSending(false);
  };

  const handleDirectKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;

    // AltGr no Windows/Linux = Ctrl+Alt juntos — não é modificador real
    const isAltGr = e.ctrlKey && e.altKey;
    // No Mac, Command (metaKey) é mapeado para Ctrl no contexto de terminal
    const ctrl = isAltGr ? false : (e.ctrlKey || e.metaKey);
    const meta = isAltGr ? false : e.altKey;
    const shift = e.shiftKey;

    // Teclas que têm comportamento padrão indesejado no browser
    const shouldPrevent = ctrl || meta || [
      "Tab", "Enter", "Backspace", "Escape", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown",
      "F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
    ].includes(e.key);

    if (shouldPrevent) e.preventDefault();

    sendKey(e.key, ctrl, meta, shift);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.trim()) sendText(input);
      else sendKey("Enter");
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

  const CURSOR_MARKER = "\uE000";
  const CURSOR_HTML = '<span class="terminal-cursor">|</span>';

  const outputHtml = useMemo(() => {
    if (!output) return null;
    try {
      const html = ansiConverter.toHtml(output);
      return html.includes(CURSOR_MARKER) ? html.replace(CURSOR_MARKER, CURSOR_HTML) : html;
    } catch { return null; }
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
            onClick={() => setShowConfig((v) => !v)}
            title="Configurações do terminal"
            style={{ fontSize: 11, padding: "3px 8px" }}
          >
            ⚙
          </button>
          <button
            className="btn"
            onClick={() => { setLoadingSessions(true); fetchSessions(); if (selected) connectSSE(selected, captureLines, refreshRate); }}
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

      {showConfig && (
        <div style={{
          display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "8px 12px", marginBottom: 8, flexShrink: 0,
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
            Linhas de scrollback
            <input
              type="number"
              min={10}
              max={2000}
              value={captureLines}
              onChange={(e) => {
                const v = Math.max(10, Math.min(2000, parseInt(e.target.value) || 100));
                setCaptureLines(v);
                localStorage.setItem("termCaptureLines", String(v));
              }}
              className="input"
              style={{ width: 64, fontSize: 11, padding: "3px 6px", textAlign: "center" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
            Refresh rate (ms)
            <input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={refreshRate}
              onChange={(e) => {
                const v = Math.max(100, Math.min(10000, parseInt(e.target.value) || 300));
                setRefreshRate(v);
                localStorage.setItem("termRefreshRate", String(v));
              }}
              className="input"
              style={{ width: 72, fontSize: 11, padding: "3px 6px", textAlign: "center" }}
            />
          </label>
        </div>
      )}

      <pre
        ref={outputRef}
        tabIndex={directMode ? 0 : -1}
        onKeyDown={directMode ? handleDirectKeyDown : undefined}
        onMouseDown={isMobile ? (e) => e.preventDefault() : undefined}
        onTouchEnd={isMobile ? () => inputRef.current?.focus() : undefined}
        onClick={() => directMode && outputRef.current?.focus()}
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
          outline: "1px solid " + (directMode ? "var(--primary)" : "transparent"),
          cursor: directMode ? "text" : "default",
        }}
        dangerouslySetInnerHTML={outputHtml ? { __html: outputHtml } : undefined}
      >
        {outputHtml ? undefined : "Aguardando saída..."}
      </pre>

      {error && (
        <div style={{ color: "var(--error)", fontSize: 12, marginTop: 6, flexShrink: 0 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {SPECIAL_KEYS.map(({ label, key, ctrl, title }) => (
          <button
            key={title}
            className="btn"
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onTouchEnd={isMobile ? (e) => { e.preventDefault(); sendKey(key, ctrl ?? false, false, label === "⇤Tab"); setTimeout(() => inputRef.current?.focus(), 0); } : undefined}
            onClick={() => sendKey(key, ctrl ?? false, false, label === "⇤Tab")}
            style={{ fontSize: 11, padding: "4px 8px", minWidth: 0, fontFamily: "monospace" }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6, flexShrink: 0, alignItems: "center" }}>
        {directMode ? (
          <>
            <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
              modo direto • cada tecla é enviada imediatamente
            </div>
            <button
              className="btn"
              onClick={() => setDirectMode(false)}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              Campo de texto
            </button>
          </>
        ) : (
          <>
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
              onMouseDown={(e) => e.preventDefault()}
              onTouchEnd={isMobile ? (e) => { e.preventDefault(); sendText(input); setTimeout(() => inputRef.current?.focus(), 0); } : undefined}
              onClick={() => sendText(input)}
              disabled={sending || !input.trim()}
              style={{ fontSize: 12, minWidth: 60 }}
            >
              {sending ? "..." : "Enviar"}
            </button>
            <button
              className="btn"
              onClick={() => setDirectMode(true)}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              Modo direto
            </button>
          </>
        )}
      </div>
    </div>
  ) : !isMobile ? (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
      Selecione uma sessão
    </div>
  ) : null;

  return (
    <div ref={containerRef} style={isMobile && selected ? {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      height: vpHeight ?? "100dvh",
      padding: "8px 12px",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      overflow: "hidden",
      background: "var(--bg-primary)",
      zIndex: 100,
    } : {
      marginLeft: -24, marginRight: -24, marginTop: -24,
      padding: "16px 24px",
      display: "flex",
      flexDirection: "column",
      height: vpHeight ?? "100dvh",
      boxSizing: "border-box",
      overflow: "hidden",
    }}>
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
