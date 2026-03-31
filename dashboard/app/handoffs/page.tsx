"use client";
import { useEffect, useState } from "react";
import type { Handoff } from "../lib/types";
import { useAgentListFull } from "../lib/useAgentList";

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
      <div className="card" style={{ width: 480, display: "flex", flexDirection: "column", gap: 12 }}>
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
      <div className="card" style={{ width: 480, display: "flex", flexDirection: "column", gap: 12 }}>
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

export default function HandoffsPage() {
  const agents = useAgentListFull(false);
  const [filter, setFilter] = useState("all");
  const [inbox, setInbox] = useState<Handoff[]>([]);
  const [archive, setArchive] = useState<Handoff[]>([]);
  const [tab, setTab] = useState<"inbox" | "archive">("inbox");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [editing, setEditing] = useState<Handoff | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/handoffs?agent=${filter}`)
      .then((r) => r.json())
      .then((data) => { setInbox(data.inbox || []); setArchive(data.archive || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter]);

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

  const items = tab === "inbox" ? inbox : archive;

  const expectsBadge: Record<string, string> = {
    action: "badge-error",
    info: "badge-info",
    review: "badge-warning",
  };

  return (
    <div>
      {showNew && <NewHandoffModal agents={agents} onClose={() => setShowNew(false)} onCreated={load} />}
      {editing && <EditHandoffModal handoff={editing} isArchived={tab === "archive"} onClose={() => setEditing(null)} onSaved={load} />}

      <div className="page-header">
        <h1 className="page-title">Handoffs</h1>
        <div className="flex-row">
          <button className="badge badge-info pointer" onClick={() => setShowNew(true)}>+ Novo</button>
          <button
            className={`badge ${filter === "all" ? "badge-info" : "badge-muted"} pointer`}
            onClick={() => setFilter("all")}
          >
            Todos
          </button>
          {agents.map((a) => (
            <button
              key={a.name}
              className={`badge ${filter === a.name ? "badge-info" : "badge-muted"} pointer`}
              onClick={() => setFilter(filter === a.name ? "all" : a.name)}
            >
              {a.display_name}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
          Inbox ({inbox.length})
        </button>
        <button className={`tab ${tab === "archive" ? "active" : ""}`} onClick={() => setTab("archive")}>
          Archive ({archive.length})
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">Nenhum handoff {tab === "inbox" ? "pendente" : "arquivado"}</div>
      ) : (
        <div className="flex-col">
          {items.map((ho) => (
            <div key={ho.id} className="card pointer" onClick={() => setExpanded(expanded === ho.id ? null : ho.id)}>
              <div className="flex-between mb-sm">
                <div className="flex-row">
                  <span className="mono-md font-semibold">{ho.id}</span>
                  <span className="text-muted-sm">
                    {ho.from} → {ho.to}
                  </span>
                  {ho.reply_to && <span className="text-muted-xs">(reply to {ho.reply_to})</span>}
                </div>
                <div className="flex-row">
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
                <pre className="mono-sm text-secondary-sm pre-wrap" style={{ marginTop: 12, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius-sm)" }}>
                  {ho.body}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
