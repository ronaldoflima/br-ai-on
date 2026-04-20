"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import AnsiToHtml from "ansi-to-html";
import styles from "./terminal.module.css";
import { FileExplorer } from "../components/FileExplorer";
import { FileViewer } from "../components/FileViewer";
import { IconChevronLeft, IconChevronRight } from "../components/icons";

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

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function linkifyHtml(html: string): string {
  return html.replace(URL_RE, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="terminal-link">${url}</a>`);
}

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
  const [directFocused, setDirectFocused] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);
  const [mobileView, setMobileView] = useState<"terminal" | "files" | "fileviewer">("terminal");
  const [filePanelWidth, setFilePanelWidth] = useState(400);
  const resizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const [textSelectable, setTextSelectable] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("termTextSelectable") === "true";
    return false;
  });
  const [captureLines, setCaptureLines] = useState(() => {
    if (typeof window !== "undefined") return parseInt(localStorage.getItem("termCaptureLines") ?? "100") || 100;
    return 100;
  });
  const [refreshRate, setRefreshRate] = useState(() => {
    if (typeof window !== "undefined") return parseInt(localStorage.getItem("termRefreshRate") ?? "100") || 100;
    return 100;
  });
  const outputRef = useRef<HTMLPreElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileDirectInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

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
    if (directMode && selected) {
      mobileDirectInputRef.current?.focus();
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

  const handleDirectChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    const val = e.target.value;
    e.target.value = "";
    for (const char of val) {
      sendKey(char);
    }
  }, [sendKey]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleDirectInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    if (!composingRef.current) return;
    const target = e.target as HTMLInputElement;
    const val = target.value;
    target.value = "";
    for (const char of val) {
      sendKey(char);
    }
  }, [sendKey]);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    (e.target as HTMLInputElement).value = "";
  }, []);

  const handleDirectInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
    const isAltGr = e.ctrlKey && e.altKey;
    const ctrl = isAltGr ? false : (e.ctrlKey || e.metaKey);
    const meta = isAltGr ? false : e.altKey;
    const shift = e.shiftKey;
    const specialKeys = [
      "Tab", "Enter", "Backspace", "Escape", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown",
      "F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
    ];
    if (ctrl || meta || specialKeys.includes(e.key)) {
      e.preventDefault();
      sendKey(e.key, ctrl, meta, shift);
    }
    // Caracteres regulares (incluindo acentuados compostos) são tratados pelo onChange
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

  const handleFileSelect = (path: string, name: string) => {
    setSelectedFile({ path, name });
    if (isMobile) setMobileView("fileviewer");
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    resizeStartXRef.current = clientX;
    resizeStartWidthRef.current = filePanelWidth;
  };

  useEffect(() => {
    const onMove = (clientX: number) => {
      if (!resizingRef.current) return;
      const delta = resizeStartXRef.current - clientX;
      const newWidth = Math.max(250, Math.min(800, resizeStartWidthRef.current + delta));
      setFilePanelWidth(newWidth);
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => { if (!resizingRef.current) return; e.preventDefault(); onMove(e.touches[0].clientX); };
    const onEnd = () => { resizingRef.current = false; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  const CURSOR_MARKER = "\uE000";
  const CURSOR_PLACEHOLDER = "__TERMINAL_CURSOR__";
  const CURSOR_HTML = '<span class="terminal-cursor"></span>';

  const outputHtml = useMemo(() => {
    if (!output) return null;
    try {
      // Replace PUA marker with safe ASCII placeholder before ANSI-to-HTML
      // conversion — escapeXML encodes \uE000 as &#xE000; which breaks
      // the raw-character check that was here before.
      const safe = output.replace(CURSOR_MARKER, CURSOR_PLACEHOLDER);
      const html = ansiConverter.toHtml(safe);
      const withCursor = html.includes(CURSOR_PLACEHOLDER)
        ? html.replace(CURSOR_PLACEHOLDER, CURSOR_HTML)
        : html;
      return linkifyHtml(withCursor);
    } catch { return null; }
  }, [output]);

  const showSessionList = !isMobile || !selected;
  const showTerminal = !isMobile || !!selected;

  const sessionsList = isMobile ? (
    <div className={styles.sessionsListMobile}>
      <div className={styles.sessionsHeader}>
        <span className={styles.sessionsLabel}>Sessões tmux</span>
        <button className={`btn ${styles.newSessionBtn}`} onClick={() => setShowNewSession((v) => !v)} title="Nova sessão">+</button>
      </div>
      {showNewSession && (
        <div className={styles.newSessionRow}>
          <input className={`input ${styles.newSessionInput}`} placeholder="Nome da sessão" value={newSessionName} onChange={(e) => setNewSessionName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createSession(); if (e.key === "Escape") setShowNewSession(false); }} autoFocus />
          <button className={`btn btn-primary ${styles.newSessionSubmit}`} onClick={createSession} disabled={creating || !newSessionName.trim()}>{creating ? "..." : "Criar"}</button>
        </div>
      )}
      {loadingSessions ? <div className={styles.statusMsg}>Carregando...</div> : sessions.length === 0 ? <div className={styles.statusMsg}>Nenhuma sessão ativa</div> : (
        <div className={styles.mobileChips}>
          {sessions.map((s) => <button key={s.name} onClick={() => setSelected(s.name)} className={selected === s.name ? styles.mobileChipActive : styles.mobileChip}>{s.name}</button>)}
        </div>
      )}
    </div>
  ) : sessionsCollapsed ? (
    <div className={styles.sessionsListCollapsed}>
      <button className={styles.sessionsCollapseToggle} onClick={() => setSessionsCollapsed(false)} title="Expandir sessões"><IconChevronRight /></button>
      {sessions.map((s) => (
        <button
          key={s.name}
          onClick={() => setSelected(s.name)}
          className={selected === s.name ? styles.sessionDotActive : styles.sessionDot}
          title={s.name}
        />
      ))}
    </div>
  ) : (
    <div className={styles.sessionsList}>
      <div className={styles.sessionsHeader}>
        <span className={styles.sessionsLabel}>Sessões tmux</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`btn ${styles.newSessionBtn}`} onClick={() => setShowNewSession((v) => !v)} title="Nova sessão">+</button>
          <button className={`btn ${styles.newSessionBtn}`} onClick={() => setSessionsCollapsed(true)} title="Recolher"><IconChevronLeft /></button>
        </div>
      </div>
      {showNewSession && (
        <div className={styles.newSessionRow}>
          <input className={`input ${styles.newSessionInput}`} placeholder="Nome da sessão" value={newSessionName} onChange={(e) => setNewSessionName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createSession(); if (e.key === "Escape") setShowNewSession(false); }} autoFocus />
          <button className={`btn btn-primary ${styles.newSessionSubmit}`} onClick={createSession} disabled={creating || !newSessionName.trim()}>{creating ? "..." : "Criar"}</button>
        </div>
      )}
      {loadingSessions ? (
        <div className={styles.statusMsg}>Carregando...</div>
      ) : sessions.length === 0 ? (
        <div className={styles.statusMsg}>Nenhuma sessão ativa</div>
      ) : (
        sessions.map((s) => (
          <button key={s.name} onClick={() => setSelected(s.name)} className={selected === s.name ? styles.sessionItemActive : styles.sessionItem}>
            <span className={selected === s.name ? styles.sessionNameActive : styles.sessionName}>{s.name}</span>
            <span className={styles.sessionMeta}>{s.windows}w {s.attached ? "· anexada" : ""}</span>
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
            onClick={() => setShowConfig((v) => !v)}
            title="Configurações do terminal"
          >
            ⚙
          </button>
          {selected && (
            <button
              className={`btn ${styles.toolbarBtn} ${showFiles ? styles.toolbarBtnActive : ""}`}
              onClick={() => {
                if (isMobile) {
                  setMobileView("files");
                } else {
                  setShowFiles((v) => !v);
                  setSelectedFile(null);
                }
              }}
              title="Explorador de arquivos"
            >
              📁
            </button>
          )}
          <button
            className={`btn ${styles.toolbarBtn}`}
            onClick={() => { setLoadingSessions(true); fetchSessions(); if (selected) connectSSE(selected, captureLines, refreshRate); }}
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

      {showConfig && (
        <div className={styles.configPanel}>
          <label className={styles.configLabel}>
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
              className={`input ${styles.configInput}`}
            />
          </label>
          <label className={styles.configLabel}>
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
              className={`input ${styles.configInputWide}`}
            />
          </label>
          <label className={styles.configLabel}>
            <input
              type="checkbox"
              checked={textSelectable}
              onChange={(e) => {
                setTextSelectable(e.target.checked);
                localStorage.setItem("termTextSelectable", String(e.target.checked));
              }}
            />
            Selecionar texto
          </label>
        </div>
      )}

      <div
        className={styles.outputScroll}
        style={{ outline: "1px solid " + (directMode && directFocused ? "var(--primary)" : "transparent") }}
        onClick={textSelectable ? undefined : () => directMode ? mobileDirectInputRef.current?.focus() : inputRef.current?.focus()}
        onTouchEnd={isMobile && !textSelectable ? () => directMode ? mobileDirectInputRef.current?.focus() : inputRef.current?.focus() : undefined}
      >
        <pre
          ref={outputRef}
          tabIndex={-1}
          onMouseDown={isMobile && !textSelectable ? (e) => e.preventDefault() : undefined}
          className={isMobile ? styles.outputMobile : styles.output}
          style={{
            cursor: textSelectable ? "text" : (directMode ? "text" : "default"),
            userSelect: textSelectable ? "text" : "none",
            WebkitUserSelect: textSelectable ? "text" : "none",
            WebkitTouchCallout: textSelectable ? "default" : "none",
          }}
          dangerouslySetInnerHTML={outputHtml ? { __html: outputHtml } : undefined}
        >
          {outputHtml ? undefined : "Aguardando saída..."}
        </pre>
      </div>

      {error && (
        <div className={styles.errorMsg}>{error}</div>
      )}

      <div className={styles.specialKeys}>
        {SPECIAL_KEYS.map(({ label, key, ctrl, title }) => (
          <button
            key={title}
            className={`btn ${styles.specialKeyBtn}`}
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onTouchEnd={isMobile ? (e) => { e.preventDefault(); sendKey(key, ctrl ?? false, false, label === "⇤Tab"); setTimeout(() => (directMode ? mobileDirectInputRef.current : inputRef.current)?.focus(), 0); } : undefined}
            onClick={() => sendKey(key, ctrl ?? false, false, label === "⇤Tab")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.inputRow}>
        {directMode ? (
          <>
            <input
              key="direct-input"
              ref={mobileDirectInputRef}
              onChange={handleDirectChange}
              onInput={handleDirectInput}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleDirectInputKeyDown}
              onFocus={() => setDirectFocused(true)}
              onBlur={() => setDirectFocused(false)}
              autoCorrect="off"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: 20,
                height: 20,
                opacity: 0.01,
                fontSize: 16,
                border: "none",
                padding: 0,
                background: "transparent",
                color: "transparent",
                caretColor: "transparent",
                zIndex: -1,
              }}
            />
            <div
              className={styles.directModeLabel}
              onClick={() => mobileDirectInputRef.current?.focus()}
            >
              {isMobile ? "modo direto • toque aqui ou no terminal para digitar" : "modo direto • cada tecla é enviada imediatamente"}
            </div>
            <button
              className={`btn ${styles.modeToggleBtn}`}
              onClick={() => setDirectMode(false)}
            >
              Campo de texto
            </button>
          </>
        ) : (
          <>
            <input
              key="text-input"
              ref={inputRef}
              className={`input ${styles.textInput}`}
              placeholder={isMobile ? "Digite e pressione Enviar..." : "Digite e pressione Enter para enviar..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <button
              className={`btn btn-primary ${styles.sendBtn}`}
              onMouseDown={(e) => e.preventDefault()}
              onTouchEnd={isMobile ? (e) => { e.preventDefault(); sendText(input); setTimeout(() => inputRef.current?.focus(), 0); } : undefined}
              onClick={() => sendText(input)}
              disabled={sending || !input.trim()}
            >
              {sending ? "..." : "Enviar"}
            </button>
            <button
              className={`btn ${styles.modeToggleBtn}`}
              onClick={() => setDirectMode(true)}
            >
              Modo direto
            </button>
          </>
        )}
      </div>
    </div>
  ) : !isMobile ? (
    <div className={styles.emptyState}>
      Selecione uma sessão
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={isMobile && selected ? styles.wrapperMobileSelected : styles.wrapper} style={{ height: vpHeight ?? "100dvh" }}>
      <div className={`page-header ${styles.header}`}>
        <h1 className="page-title">Terminais</h1>
      </div>

      {isMobile ? (
        <div className={styles.mobileLayout}>
          {mobileView === "terminal" && showSessionList && sessionsList}
          {mobileView === "terminal" && showTerminal && terminalPanel}
          {mobileView === "files" && selected && (
            <div className={styles.mobilePanelFull}>
              <div className={styles.mobilePanelHeader}>
                <button className={`btn ${styles.backBtn}`} onClick={() => setMobileView("terminal")}>
                  ← Terminal
                </button>
                <span className={styles.mobilePanelTitle}>Arquivos</span>
              </div>
              <FileExplorer session={selected} onFileSelect={handleFileSelect} />
            </div>
          )}
          {mobileView === "fileviewer" && selected && selectedFile && (
            <div className={styles.mobilePanelFull}>
              <FileViewer
                session={selected}
                filePath={selectedFile.path}
                fileName={selectedFile.name}
                onClose={() => { setSelectedFile(null); setMobileView("files"); }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className={showFiles && selected ? styles.desktopLayoutWithFiles : styles.desktopLayout}>
          {sessionsList}
          {terminalPanel}
          {showFiles && selected && (
            <>
              <div className={styles.resizeHandle} onMouseDown={handleResizeStart} onTouchStart={handleResizeStart} />
              <div className={styles.filePanel} style={{ width: filePanelWidth }}>
              {selectedFile ? (
                <FileViewer
                  session={selected}
                  filePath={selectedFile.path}
                  fileName={selectedFile.name}
                  onClose={() => setSelectedFile(null)}
                />
              ) : (
                <FileExplorer
                  session={selected}
                  onFileSelect={handleFileSelect}
                />
              )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
