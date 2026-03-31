"use client";

import { useState, useEffect, useCallback } from "react";
import MemoryModal from "./MemoryModal";
import { Memory, MemoryType, Project } from "./types";

const TYPE_BADGE: Record<string, string> = {
  feedback: "badge-warning",
  project: "badge-info",
  user: "badge-success",
  reference: "badge-muted",
};

function timeAgo(dateStr: string): string {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function shortName(name: string): string {
  const parts = name.split("-");
  return parts[parts.length - 1] || name;
}

interface Toast { id: number; message: string; type: "success" | "error" }

interface Props {
  showHeader?: boolean;
}

export default function MemoriesList({ showHeader = false }: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Memory | null | "new">(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: "success" | "error") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  };

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/memories/projects");
    setProjects(await res.json());
  }, []);

  const fetchMemories = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedProject) params.set("project", selectedProject);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (search) params.set("search", search);
    const res = await fetch(`/api/memories?${params}`);
    setMemories(await res.json());
    setLoading(false);
  }, [selectedProject, typeFilter, search]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(fetchMemories, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchMemories, search]);

  const handleSave = async (data: {
    id?: string; projectSlug: string; name: string;
    description: string; type: MemoryType; body: string;
  }) => {
    try {
      if (data.id) {
        const res = await fetch(`/api/memories/${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: data.name, description: data.description, type: data.type, body: data.body }),
        });
        if (!res.ok) { addToast((await res.json()).message, "error"); return; }
        addToast("Memória atualizada", "success");
      } else {
        const res = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) { addToast((await res.json()).message, "error"); return; }
        addToast("Memória criada", "success");
      }
      setModal(null);
      fetchMemories();
      fetchProjects();
    } catch { addToast("Erro ao salvar", "error"); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) { addToast((await res.json()).message, "error"); return; }
      addToast("Memória deletada", "success");
      setModal(null);
      fetchMemories();
      fetchProjects();
    } catch { addToast("Erro ao deletar", "error"); }
  };

  return (
    <div>
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type === "success" ? "toast-success" : "toast-error"}`}>
          {t.message}
        </div>
      ))}

      {showHeader && (
        <div className="page-header">
          <h1 className="page-title">Memórias</h1>
          <span className="text-muted-sm">
            {loading ? "—" : `${memories.length} ${memories.length === 1 ? "memória" : "memórias"}`}
          </span>
        </div>
      )}

      <div className="filters">
        <select
          className="select"
          value={selectedProject ?? ""}
          onChange={(e) => setSelectedProject(e.target.value || null)}
        >
          <option value="">Todos os projetos</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {shortName(p.name)} ({p.memoryCount})
            </option>
          ))}
        </select>
        <select
          className="select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as MemoryType | "all")}
        >
          <option value="all">Todos os tipos</option>
          <option value="user">user</option>
          <option value="feedback">feedback</option>
          <option value="project">project</option>
          <option value="reference">reference</option>
        </select>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          style={{ flex: 1 }}
        />
        <button onClick={() => setModal("new")} className="btn btn-primary">
          + Nova
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Carregando...</div>
      ) : memories.length === 0 ? (
        <div className="empty-state">Nenhuma memória encontrada</div>
      ) : (
        <div className="grid grid-2">
          {memories.map((m) => (
            <button
              key={m.id}
              onClick={() => setModal(m)}
              className="card card-hover pointer"
              style={{ textAlign: "left", display: "block" }}
            >
              <span className={`badge ${TYPE_BADGE[m.type] ?? "badge-muted"}`}>
                {m.type}
              </span>
              <div className="font-semibold mt-sm" style={{ fontSize: "13px" }}>{m.name}</div>
              {m.description && (
                <div className="text-muted-sm mt-sm truncate">{m.description}</div>
              )}
              <div className="flex-between mt-sm text-muted-xs">
                <span className="truncate" style={{ maxWidth: "70%" }}>{shortName(m.projectName)}</span>
                <span>{timeAgo(m.lastModified)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {modal !== null && (
        <MemoryModal
          memory={modal === "new" ? null : modal}
          projects={projects}
          defaultProjectSlug={selectedProject}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
