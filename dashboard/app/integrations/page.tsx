"use client";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

interface ObsidianRule {
  id: string;
  name: string;
  enabled: boolean;
  folder: string;
  filter: {
    type: "tag" | "property" | "none";
    value: string;
  };
  agent: string;
  created_at: string;
}

interface IntegrationsData {
  obsidian_rules: ObsidianRule[];
}

const EMPTY_RULE: Omit<ObsidianRule, "id" | "created_at"> = {
  name: "",
  enabled: true,
  folder: "",
  filter: { type: "none", value: "" },
  agent: "",
};

export default function IntegrationsPage() {
  const [data, setData] = useState<IntegrationsData>({ obsidian_rules: [] });
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ObsidianRule, "id" | "created_at">>(EMPTY_RULE);
  const [error, setError] = useState("");

  async function fetchAll() {
    setLoading(true);
    const [intRes, agentsRes] = await Promise.all([
      fetch("/api/integrations"),
      fetch("/api/agents"),
    ]);
    const intData = intRes.ok ? await intRes.json() : { obsidian_rules: [] };
    const agentsData = agentsRes.ok ? await agentsRes.json() : [];
    setData(intData);
    setAgents(
      (agentsData as { name: string }[])
        .map((a) => a.name)
        .filter((n) => !n.startsWith("_"))
    );
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, []);

  async function save(updated: IntegrationsData) {
    setSaving(true);
    const res = await fetch("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSaving(false);
    return res.ok;
  }

  function openNew() {
    setForm(EMPTY_RULE);
    setEditingId(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(rule: ObsidianRule) {
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      folder: rule.folder,
      filter: { ...rule.filter },
      agent: rule.agent,
    });
    setEditingId(rule.id);
    setError("");
    setModalOpen(true);
  }

  async function submitModal() {
    if (!form.name.trim() || !form.folder.trim() || !form.agent) {
      setError("Nome, pasta e agente são obrigatórios.");
      return;
    }
    const updated = { ...data };
    if (editingId) {
      updated.obsidian_rules = updated.obsidian_rules.map((r) =>
        r.id === editingId ? { ...r, ...form } : r
      );
    } else {
      const newId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
      updated.obsidian_rules = [
        ...updated.obsidian_rules,
        { id: newId, created_at: new Date().toISOString(), ...form },
      ];
    }
    const ok = await save(updated);
    if (ok) {
      setData(updated);
      setModalOpen(false);
    } else {
      setError("Erro ao salvar.");
    }
  }

  async function removeRule(id: string) {
    const updated = { ...data, obsidian_rules: data.obsidian_rules.filter((r) => r.id !== id) };
    const ok = await save(updated);
    if (ok) setData(updated);
  }

  async function toggleRule(id: string) {
    const updated = {
      ...data,
      obsidian_rules: data.obsidian_rules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      ),
    };
    const ok = await save(updated);
    if (ok) setData(updated);
  }

  const filterLabel = (f: ObsidianRule["filter"]) => {
    if (f.type === "none") return "sem filtro";
    return `${f.type}: ${f.value}`;
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Integrações</h1>
      </div>

      <div className={styles.section}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div className={styles.sectionTitle}>Obsidian Inbox</div>
              <div className={styles.sectionDesc}>
                Monitora pastas do Obsidian e cria handoffs automaticamente quando novas notas aparecem.
              </div>
            </div>
            <button className="btn btn-primary" onClick={openNew} disabled={saving}>
              Nova Regra
            </button>
          </div>

          {loading ? (
            <div className={styles.empty}>Carregando...</div>
          ) : data.obsidian_rules.length === 0 ? (
            <div className={styles.empty}>
              Nenhuma regra configurada. Clique em Nova Regra para começar.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.obsidian_rules.map((rule) => (
                <div key={rule.id} className={`card ${styles.ruleCard}`}>
                  <div className={styles.ruleInfo}>
                    <div className={styles.ruleName}>{rule.name}</div>
                    <div className={styles.ruleMeta}>
                      <span className={styles.ruleFolder} title={rule.folder}>{rule.folder}</span>
                      <span>{filterLabel(rule.filter)}</span>
                      <span className="badge badge-muted">{rule.agent}</span>
                    </div>
                  </div>
                  <div className={styles.ruleActions}>
                    <label className={styles.toggle} title={rule.enabled ? "Desativar" : "Ativar"}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => toggleRule(rule.id)}
                      />
                      <span className={styles.toggleSlider} />
                    </label>
                    <button className="btn" onClick={() => openEdit(rule)}>Editar</button>
                    <button
                      className="btn"
                      style={{ color: "var(--error)" }}
                      onClick={() => removeRule(rule.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>{editingId ? "Editar Regra" : "Nova Regra"}</div>

            <div className="form-group">
              <label className="form-label">Nome da regra</label>
              <input
                className="input"
                placeholder="Ex: Inbox geral"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Pasta a monitorar</label>
              <input
                className="input"
                placeholder="/home/user/obsidian/geral/inbox"
                value={form.folder}
                onChange={(e) => setForm({ ...form, folder: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Filtro</label>
              <select
                className="input"
                value={form.filter.type}
                onChange={(e) =>
                  setForm({ ...form, filter: { type: e.target.value as ObsidianRule["filter"]["type"], value: "" } })
                }
              >
                <option value="none">Sem filtro</option>
                <option value="tag">Por tag</option>
                <option value="property">Por property</option>
              </select>
              {form.filter.type !== "none" && (
                <input
                  className={`input ${styles.filterValue}`}
                  placeholder={form.filter.type === "tag" ? "Ex: agente/finance" : "Ex: agent"}
                  value={form.filter.value}
                  onChange={(e) => setForm({ ...form, filter: { ...form.filter, value: e.target.value } })}
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Agente</label>
              <select
                className="input"
                value={form.agent}
                onChange={(e) => setForm({ ...form, agent: e.target.value })}
              >
                <option value="">Selecione um agente</option>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            {error && <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

            <div className={styles.modalFooter}>
              <button className="btn" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={submitModal} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
