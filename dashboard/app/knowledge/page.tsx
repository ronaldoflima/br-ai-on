"use client"
import { useEffect, useState, useCallback, useRef } from "react"
import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  KnowledgeType,
  KnowledgeSource,
  CreateKnowledgeInput,
} from "../lib/types"
import styles from "./knowledge.module.css"

const TYPE_COLORS: Record<KnowledgeType, string> = {
  insight: "badge-info",
  decision: "badge-warning",
  fact: "badge-success",
  procedure: "badge-muted",
}

interface EntryFormData {
  text: string
  agent: string
  domain: string
  type: KnowledgeType
  source: KnowledgeSource
}

const EMPTY_FORM: EntryFormData = {
  text: "",
  agent: "",
  domain: "",
  type: "fact",
  source: "manual",
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<(KnowledgeEntry | KnowledgeSearchResult)[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [nextOffset, setNextOffset] = useState<string | null>(null)
  const nextOffsetRef = useRef<string | null>(null)

  const [agentFilter, setAgentFilter] = useState("")
  const [domainFilter, setDomainFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")

  const [agents, setAgents] = useState<string[]>([])
  const [domains, setDomains] = useState<string[]>([])

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EntryFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/knowledge/meta")
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.agents || [])
        setDomains(data.domains || [])
      })
      .catch(() => {})
  }, [])

  const fetchEntries = useCallback(
    (append = false) => {
      if (!append) setLoading(true)
      const params = new URLSearchParams()
      if (agentFilter) params.set("agent", agentFilter)
      if (domainFilter) params.set("domain", domainFilter)
      if (typeFilter) params.set("type", typeFilter)
      params.set("limit", "20")
      if (append && nextOffsetRef.current) params.set("offset", nextOffsetRef.current)

      fetch(`/api/knowledge/entries?${params}`)
        .then((r) => r.json())
        .then((data) => {
          const list = data.entries || []
          setEntries((prev) => (append ? [...prev, ...list] : list))
          setNextOffset(data.next_offset)
          nextOffsetRef.current = data.next_offset
          setIsSearchMode(false)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    },
    [agentFilter, domainFilter, typeFilter]
  )

  useEffect(() => {
    fetchEntries()
  }, [agentFilter, domainFilter, typeFilter])

  const doSearch = () => {
    if (!searchQuery.trim()) {
      fetchEntries()
      return
    }
    setLoading(true)
    fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        agent: agentFilter || undefined,
        domain: domainFilter || undefined,
        type: typeFilter || undefined,
        limit: 20,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.results || [])
        setIsSearchMode(true)
        setNextOffset(null)
        nextOffsetRef.current = null
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doSearch()
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError("")
    setShowModal(true)
  }

  const openEdit = (entry: KnowledgeEntry) => {
    setForm({
      text: entry.text,
      agent: entry.agent,
      domain: entry.domain.join(", "),
      type: entry.type,
      source: entry.source,
    })
    setEditingId(entry.id)
    setError("")
    setShowModal(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError("")
    try {
      const domainArr = form.domain
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)

      if (editingId) {
        const res = await fetch(`/api/knowledge/entries/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: form.text,
            agent: form.agent,
            domain: domainArr,
            type: form.type,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Erro ao atualizar")
        }
      } else {
        const input: CreateKnowledgeInput = {
          text: form.text,
          agent: form.agent,
          domain: domainArr,
          type: form.type,
          source: form.source,
        }
        const res = await fetch("/api/knowledge/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Erro ao criar")
        }
      }
      setShowModal(false)
      fetchEntries()
    } catch (err) {
      setError(String(err))
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Deletar este entry?")) return
    await fetch(`/api/knowledge/entries/${id}`, { method: "DELETE" })
    fetchEntries()
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return iso
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className="page-header">
        <h1 className="page-title">Knowledge Base</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          + Novo Entry
        </button>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Busca semantica..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary" onClick={doSearch}>
          Buscar
        </button>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.filterSelect}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">Todos agentes</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="">Todos dominios</option>
          {domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Todos tipos</option>
          <option value="insight">Insight</option>
          <option value="decision">Decision</option>
          <option value="fact">Fact</option>
          <option value="procedure">Procedure</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.empty}>Carregando...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>Nenhum entry encontrado</div>
      ) : (
        <>
          {entries.map((entry) => (
            <div key={entry.id} className={`card ${styles.entryCard}`}>
              <div className={styles.entryHeader}>
                <span className={`badge ${TYPE_COLORS[entry.type]}`}>
                  {entry.type}
                </span>
                <span className="badge badge-muted">{entry.agent}</span>
                {entry.domain.map((d) => (
                  <span key={d} className="badge badge-muted" style={{ fontSize: 10 }}>
                    {d}
                  </span>
                ))}
                {"score" in entry && (
                  <span className={styles.scoreBar}>
                    {(entry.score as number).toFixed(3)}
                  </span>
                )}
              </div>
              <div className={styles.entryText}>{entry.text}</div>
              <div className={styles.entryFooter}>
                <span className={styles.entryDate}>
                  {formatDate(entry.created_at)}
                  {entry.source !== "manual" && ` · ${entry.source}`}
                </span>
                <div className={styles.entryActions}>
                  <button
                    className="btn btn-sm"
                    onClick={() => openEdit(entry)}
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(entry.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!isSearchMode && nextOffset && (
            <button
              className={`btn ${styles.loadMore}`}
              onClick={() => fetchEntries(true)}
            >
              Carregar mais
            </button>
          )}
        </>
      )}

      {showModal && (
        <div className={styles.modal} onClick={() => setShowModal(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 16, fontSize: 16 }}>
              {editingId ? "Editar Entry" : "Novo Entry"}
            </h2>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Texto</label>
              <textarea
                className="textarea"
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={4}
                style={{ minHeight: 100 }}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Agente</label>
              <select
                className="select"
                value={form.agent}
                onChange={(e) => setForm({ ...form, agent: e.target.value })}
              >
                <option value="">Selecionar...</option>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Dominios (separados por virgula)
              </label>
              <input
                className="input"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="netsuite, billing"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Tipo</label>
              <select
                className="select"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as KnowledgeType })
                }
              >
                <option value="insight">Insight</option>
                <option value="decision">Decision</option>
                <option value="fact">Fact</option>
                <option value="procedure">Procedure</option>
              </select>
            </div>
            {!editingId && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Source</label>
                <select
                  className="select"
                  value={form.source}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      source: e.target.value as KnowledgeSource,
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="agent-session">Agent Session</option>
                  <option value="handoff">Handoff</option>
                </select>
              </div>
            )}
            {error && (
              <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.text || !form.agent}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
