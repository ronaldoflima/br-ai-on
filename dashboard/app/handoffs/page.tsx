"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import type { Handoff } from "../lib/types";
import { useAgentListFull } from "../lib/useAgentList";
import { getAvailableTags } from "../lib/domain";
import styles from "./handoffs.module.css";

interface ArtifactFile {
  name: string;
  size: number;
  modified: string;
  type: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactViewer({ agent, id, file, onClose }: {
  agent: string;
  id: string;
  file: ArtifactFile;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/artifacts?agent=${agent}&id=${id}&file=${encodeURIComponent(file.name)}`)
      .then((r) => r.json())
      .then((data) => setContent(data.content || ""))
      .catch(() => setContent("Erro ao carregar arquivo"))
      .finally(() => setLoading(false));
  }, [agent, id, file.name]);

  function copyToClipboard() {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function download() {
    if (content == null) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex-between">
          <div className="flex-row">
            <span className="font-semibold">{file.name}</span>
            <span className="badge badge-muted">{file.type}</span>
            <span className="text-muted-xs">{formatSize(file.size)}</span>
          </div>
          <div className="flex-row">
            <button className="badge badge-info pointer" onClick={copyToClipboard}>
              {copied ? "Copiado!" : "Copiar"}
            </button>
            <button className="badge badge-info pointer" onClick={download}>Baixar</button>
            <button className="badge badge-muted pointer" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="empty-state">Carregando...</div>
          ) : (
            <pre className="mono-sm text-secondary-sm pre-wrap" style={{
              padding: 16,
              background: "var(--bg-primary)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              maxHeight: "70vh",
              overflow: "auto",
            }}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactsSection({ agent, handoffId }: { agent: string; handoffId: string }) {
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<ArtifactFile | null>(null);

  useEffect(() => {
    fetch(`/api/artifacts?agent=${agent}&id=${handoffId}`)
      .then((r) => r.json())
      .then((data) => setFiles(data.files || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agent, handoffId]);

  function downloadFile(file: ArtifactFile) {
    fetch(`/api/artifacts?agent=${agent}&id=${handoffId}&file=${encodeURIComponent(file.name)}`)
      .then((r) => r.json())
      .then((data) => {
        const blob = new Blob([data.content || ""], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  function copyFile(file: ArtifactFile) {
    fetch(`/api/artifacts?agent=${agent}&id=${handoffId}&file=${encodeURIComponent(file.name)}`)
      .then((r) => r.json())
      .then((data) => {
        navigator.clipboard.writeText(data.content || "");
      });
  }

  if (loading) return <div className="text-muted-xs" style={{ marginTop: 8 }}>Carregando artefatos...</div>;
  if (files.length === 0) return null;

  return (
    <>
      {viewing && (
        <ArtifactViewer agent={agent} id={handoffId} file={viewing} onClose={() => setViewing(null)} />
      )}
      <div style={{ marginTop: 12, padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
        <div className="flex-between mb-sm">
          <span className="text-muted-xs font-semibold" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Artefatos ({files.length})
          </span>
        </div>
        <div className="flex-col" style={{ gap: 4 }}>
          {files.map((f) => (
            <div key={f.name} className="flex-between" style={{
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}>
              <div className="flex-row">
                <span className="mono-sm">{f.name}</span>
                <span className="badge badge-muted">{f.type}</span>
                <span className="text-muted-xs">{formatSize(f.size)}</span>
              </div>
              <div className="flex-row" onClick={(e) => e.stopPropagation()}>
                <button className="badge badge-info pointer" onClick={() => setViewing(f)} title="Visualizar">
                  Ver
                </button>
                <button className="badge badge-muted pointer" onClick={() => copyFile(f)} title="Copiar conteúdo">
                  Copiar
                </button>
                <button className="badge badge-muted pointer" onClick={() => downloadFile(f)} title="Baixar arquivo">
                  Baixar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function NewHandoffModal({ agents, onClose, onCreated }: {
  agents: { name: string; display_name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [to, setTo] = useState(agents[0]?.name || "");
  const [expects, setExpects] = useState("action");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [expected, setExpected] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!description.trim()) return;
    setSaving(true);
    await fetch("/api/handoffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, expects, description, context, expected }),
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div className={`card ${styles.modalContent}`}>
        <div className="flex-between">
          <span className="font-semibold">Novo Handoff</span>
          <button className="badge badge-muted pointer" onClick={onClose}>✕</button>
        </div>

        <div className="flex-row" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="text-muted-xs" style={{ marginBottom: 4 }}>Para</div>
            <select value={to} onChange={(e) => setTo(e.target.value)}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "6px 8px" }}>
              {agents.map((a) => <option key={a.name} value={a.name}>{a.display_name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-muted-xs" style={{ marginBottom: 4 }}>Tipo</div>
            <select value={expects} onChange={(e) => setExpects(e.target.value)}
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "6px 8px" }}>
              <option value="action">action</option>
              <option value="info">info</option>
              <option value="review">review</option>
            </select>
          </div>
        </div>

        {[
          { label: "Descrição", value: description, set: setDescription, required: true },
          { label: "Contexto", value: context, set: setContext },
          { label: "Esperado", value: expected, set: setExpected },
        ].map(({ label, value, set, required }) => (
          <div key={label}>
            <div className="text-muted-xs" style={{ marginBottom: 4 }}>{label}{required && " *"}</div>
            <textarea value={value} onChange={(e) => set(e.target.value)} rows={3}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "6px 8px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        ))}

        <div className="flex-row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="badge badge-muted pointer" onClick={onClose}>Cancelar</button>
          <button className="badge badge-info pointer" onClick={submit} disabled={saving || !description.trim()}>
            {saving ? "Enviando..." : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditHandoffModal({ handoff, isArchived, onClose, onSaved }: {
  handoff: Handoff;
  isArchived: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [expects, setExpects] = useState(handoff.expects);
  const [description, setDescription] = useState(() => {
    const m = handoff.body.match(/## Descricao\n([\s\S]*?)(?=\n## |$)/);
    return m ? m[1].trim() : handoff.description;
  });
  const [context, setContext] = useState(() => {
    const m = handoff.body.match(/## Contexto\n([\s\S]*?)(?=\n## |$)/);
    return m ? m[1].trim() : "";
  });
  const [expected, setExpected] = useState(() => {
    const m = handoff.body.match(/## Esperado\n([\s\S]*?)(?=\n## |$)/);
    return m ? m[1].trim() : "";
  });
  const [restore, setRestore] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!description.trim()) return;
    setSaving(true);
    await fetch("/api/handoffs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: handoff.to, filename: handoff.filename, expects, description, context, expected, restore }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div className={`card ${styles.modalContent}`}>
        <div className="flex-between">
          <span className="font-semibold">Editar Handoff <span className="text-muted-sm">{handoff.id}</span></span>
          <button className="badge badge-muted pointer" onClick={onClose}>✕</button>
        </div>

        <div>
          <div className="text-muted-xs" style={{ marginBottom: 4 }}>Tipo</div>
          <select value={expects} onChange={(e) => setExpects(e.target.value)}
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "6px 8px" }}>
            <option value="action">action</option>
            <option value="info">info</option>
            <option value="review">review</option>
          </select>
        </div>

        {[
          { label: "Descrição", value: description, set: setDescription, required: true },
          { label: "Contexto", value: context, set: setContext },
          { label: "Esperado", value: expected, set: setExpected },
        ].map(({ label, value, set, required }) => (
          <div key={label}>
            <div className="text-muted-xs" style={{ marginBottom: 4 }}>{label}{required && " *"}</div>
            <textarea value={value} onChange={(e) => set(e.target.value)} rows={3}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "6px 8px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        ))}

        {isArchived && (
          <label className="flex-row pointer" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} />
            <span className="text-muted-sm">Mover de volta para inbox</span>
          </label>
        )}

        <div className="flex-row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="badge badge-muted pointer" onClick={onClose}>Cancelar</button>
          <button className="badge badge-info pointer" onClick={submit} disabled={saving || !description.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toggleSet(set: Set<string>, val: string): Set<string> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val);
  else next.add(val);
  return next;
}

export default function HandoffsPage() {
  const agents = useAgentListFull(false);
  const [inbox, setInbox] = useState<Handoff[]>([]);
  const [inProgress, setInProgress] = useState<Handoff[]>([]);
  const [archive, setArchive] = useState<Handoff[]>([]);
  const [tab, setTab] = useState<"inbox" | "in_progress" | "archive">("inbox");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [editing, setEditing] = useState<Handoff | null>(null);

  const [search, setSearch] = useState("");
  const [filterFrom, setFilterFrom] = useState<Set<string>>(new Set());
  const [filterTo, setFilterTo] = useState<Set<string>>(new Set());
  const [filterDomain, setFilterDomain] = useState<Set<string>>(new Set());
  const [filterSchedule, setFilterSchedule] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  function load() {
    setLoading(true);
    fetch("/api/handoffs?agent=all")
      .then((r) => r.json())
      .then((data) => { setInbox(data.inbox || []); setInProgress(data.in_progress || []); setArchive(data.archive || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function archiveHandoff(ho: Handoff, e: React.MouseEvent) {
    e.stopPropagation();
    setArchiving(ho.id);
    await fetch("/api/handoffs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: ho.to, filename: ho.filename }),
    });
    setArchiving(null);
    load();
  }

  const allHandoffs = [...inbox, ...inProgress, ...archive];
  const uniqueFrom = useMemo(() => [...new Set(allHandoffs.map((h) => h.from))].sort(), [inbox, inProgress, archive]);
  const uniqueTo = useMemo(() => [...new Set(allHandoffs.map((h) => h.to))].sort(), [inbox, inProgress, archive]);
  const allAgentTags = useMemo(
    () => agents.map((a) => a.domain).filter((d) => d.length > 0),
    [agents]
  );

  const availableDomains = useMemo(
    () => getAvailableTags(allAgentTags, filterDomain),
    [allAgentTags, filterDomain]
  );

  const agentDomainMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    agents.forEach((a) => { if (a.domain.length > 0) map[a.name] = a.domain; });
    return map;
  }, [agents]);

  const agentScheduleMap = useMemo(() => {
    const map: Record<string, string> = {};
    agents.forEach((a) => { map[a.name] = a.schedule_mode; });
    return map;
  }, [agents]);

  const filterItems = useCallback((items: Handoff[]) => {
    let result = items;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((h) =>
        h.id.toLowerCase().includes(q) ||
        h.from.toLowerCase().includes(q) ||
        h.to.toLowerCase().includes(q) ||
        h.description.toLowerCase().includes(q)
      );
    }

    if (filterFrom.size > 0) {
      result = result.filter((h) => filterFrom.has(h.from));
    }
    if (filterTo.size > 0) {
      result = result.filter((h) => filterTo.has(h.to));
    }
    if (filterDomain.size > 0) {
      result = result.filter((h) => {
        const fromTags = agentDomainMap[h.from] || [];
        const toTags = agentDomainMap[h.to] || [];
        return fromTags.some((t) => filterDomain.has(t)) || toTags.some((t) => filterDomain.has(t));
      });
    }
    if (filterSchedule.size > 0) {
      result = result.filter((h) => {
        const fromMode = agentScheduleMap[h.from];
        const toMode = agentScheduleMap[h.to];
        return (fromMode && filterSchedule.has(fromMode)) || (toMode && filterSchedule.has(toMode));
      });
    }

    result = [...result].sort((a, b) => {
      const da = new Date(a.created).getTime();
      const db = new Date(b.created).getTime();
      return sortOrder === "newest" ? db - da : da - db;
    });

    return result;
  }, [search, filterFrom, filterTo, filterDomain, filterSchedule, sortOrder, agentDomainMap, agentScheduleMap]);

  const filteredInbox = useMemo(() => filterItems(inbox), [inbox, filterItems]);
  const filteredInProgress = useMemo(() => filterItems(inProgress), [inProgress, filterItems]);
  const filteredArchive = useMemo(() => filterItems(archive), [archive, filterItems]);
  const items = tab === "inbox" ? filteredInbox : tab === "in_progress" ? filteredInProgress : filteredArchive;

  const hasFilters = search || filterFrom.size > 0 || filterTo.size > 0 || filterDomain.size > 0 || filterSchedule.size > 0;

  function clearFilters() {
    setSearch("");
    setFilterFrom(new Set());
    setFilterTo(new Set());
    setFilterDomain(new Set());
    setFilterSchedule(new Set());
  }

  const expectsBadge: Record<string, string> = {
    action: "badge-error",
    info: "badge-info",
    review: "badge-warning",
  };

  const scheduleLabels: Record<string, string> = {
    alive: "Alive",
    "handoff-only": "Handoff-only",
    disabled: "Disabled",
  };

  return (
    <div className={styles.wrapper}>
      {showNew && <NewHandoffModal agents={agents} onClose={() => setShowNew(false)} onCreated={load} />}
      {editing && <EditHandoffModal handoff={editing} isArchived={tab !== "inbox"} onClose={() => setEditing(null)} onSaved={load} />}

      <div className="page-header">
        <h1 className="page-title">Handoffs</h1>
        <button className="badge badge-info pointer" onClick={() => setShowNew(true)}>+ Novo</button>
      </div>

      <div className={styles.desktopLayout}>
        <div className={styles.filterSidebar}>
          <input
            className={styles.sidebarSearch}
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {uniqueFrom.length > 0 && (
            <>
              <div className={styles.sectionLabel}>From</div>
              {uniqueFrom.map((name) => (
                <label key={`from-${name}`} className={styles.checkItem}>
                  <input
                    type="checkbox"
                    checked={filterFrom.has(name)}
                    onChange={() => setFilterFrom(toggleSet(filterFrom, name))}
                  />
                  {name}
                </label>
              ))}
            </>
          )}

          {uniqueTo.length > 0 && (
            <>
              <div className={styles.sectionLabel}>To</div>
              {uniqueTo.map((name) => (
                <label key={`to-${name}`} className={styles.checkItem}>
                  <input
                    type="checkbox"
                    checked={filterTo.has(name)}
                    onChange={() => setFilterTo(toggleSet(filterTo, name))}
                  />
                  {name}
                </label>
              ))}
            </>
          )}

          {availableDomains.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Domínio</div>
              {availableDomains.map((d) => (
                <label key={`dom-${d}`} className={styles.checkItem}>
                  <input
                    type="checkbox"
                    checked={filterDomain.has(d)}
                    onChange={() => setFilterDomain(toggleSet(filterDomain, d))}
                  />
                  {d}
                </label>
              ))}
            </>
          )}

          <div className={styles.sectionLabel}>Schedule Mode</div>
          {["alive", "handoff-only", "disabled"].map((mode) => (
            <label key={`sched-${mode}`} className={styles.checkItem}>
              <input
                type="checkbox"
                checked={filterSchedule.has(mode)}
                onChange={() => setFilterSchedule(toggleSet(filterSchedule, mode))}
              />
              {scheduleLabels[mode]}
            </label>
          ))}

          <div className={styles.sectionLabel}>Ordenação</div>
          <select
            className={styles.sortSelect}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
          >
            <option value="newest">Mais recente</option>
            <option value="oldest">Mais antigo</option>
          </select>

          {hasFilters && (
            <button className={styles.clearBtn} onClick={clearFilters}>
              Limpar filtros
            </button>
          )}
        </div>

        <div className={styles.mainPanel}>
          <div className="tabs">
            <button className={`tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
              Inbox ({filteredInbox.length})
            </button>
            <button className={`tab ${tab === "in_progress" ? "active" : ""}`} onClick={() => setTab("in_progress")}>
              In Progress ({filteredInProgress.length})
            </button>
            <button className={`tab ${tab === "archive" ? "active" : ""}`} onClick={() => setTab("archive")}>
              Archive ({filteredArchive.length})
            </button>
          </div>

          {loading ? (
            <div className="empty-state">Carregando...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              {hasFilters ? "Nenhum handoff corresponde aos filtros" : `Nenhum handoff ${tab === "inbox" ? "pendente" : tab === "in_progress" ? "em processamento" : "arquivado"}`}
            </div>
          ) : (
            <div className="flex-col">
              {items.map((ho) => (
                <div key={`${ho.id}_${ho.from}_${ho.to}`} className="card pointer" onClick={() => setExpanded(expanded === ho.id ? null : ho.id)}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardInfo}>
                      <span className="mono-md font-semibold">{ho.id}</span>
                      <span className="text-muted-sm">
                        {ho.from} → {ho.to}
                      </span>
                      {ho.reply_to && <span className="text-muted-xs">(reply to {ho.reply_to})</span>}
                      {ho.thread_id && <span className="text-xs text-purple-400">thread: {ho.thread_id}</span>}
                    </div>
                    <div className={styles.cardActions}>
                      <span className={`badge ${expectsBadge[ho.expects] || "badge-muted"}`}>{ho.expects}</span>
                      <span className={`badge ${ho.status === "pending" ? "badge-warning" : "badge-muted"}`}>{ho.status}</span>
                      <button
                        className="badge badge-muted pointer"
                        onClick={(e) => { e.stopPropagation(); setEditing(ho); }}
                        title="Editar handoff"
                      >
                        Editar
                      </button>
                      {tab === "inbox" && (
                        <button
                          className="badge badge-muted pointer"
                          onClick={(e) => archiveHandoff(ho, e)}
                          disabled={archiving === ho.id}
                          title="Arquivar handoff"
                        >
                          {archiving === ho.id ? "..." : "Arquivar"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-secondary-sm">{ho.description}</div>
                  {ho.created && <div className="text-muted-xs mt-sm">{new Date(ho.created).toLocaleString("pt-BR")}</div>}
                  {expanded === ho.id && (
                    <>
                      <pre className="mono-sm text-secondary-sm pre-wrap" style={{ marginTop: 12, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius-sm)" }}>
                        {ho.body}
                      </pre>
                      <ArtifactsSection agent={ho.to === "user" ? ho.from : ho.to} handoffId={ho.id} />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
