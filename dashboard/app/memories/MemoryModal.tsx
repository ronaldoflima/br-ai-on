"use client";

import { useState, useEffect } from "react";
import { renderMarkdown } from "../lib/markdown";
import { Memory, MemoryType, Project } from "./types";

const TEMPLATES: Record<MemoryType, string> = {
  feedback: "**Why:**\n\n**How to apply:**",
  project: "**Why:**\n\n**How to apply:**",
  user: "",
  reference: "",
};

interface Props {
  memory: Memory | null;
  projects: Project[];
  defaultProjectSlug: string | null;
  onSave: (data: {
    id?: string;
    projectSlug: string;
    name: string;
    description: string;
    type: MemoryType;
    body: string;
  }) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export default function MemoryModal({ memory, projects, defaultProjectSlug, onSave, onDelete, onClose }: Props) {
  const isEditing = !!memory;
  const [name, setName] = useState(memory?.name ?? "");
  const [description, setDescription] = useState(memory?.description ?? "");
  const [type, setType] = useState<MemoryType>(memory?.type ?? "feedback");
  const [body, setBody] = useState(memory?.body ?? TEMPLATES.feedback);
  const [projectSlug, setProjectSlug] = useState(
    memory?.projectSlug ?? defaultProjectSlug ?? projects[0]?.slug ?? ""
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isEditing) setBody(TEMPLATES[type]);
  }, [type, isEditing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ id: memory?.id, projectSlug, name, description, type, body });
  };

  return (
    <div className="modal-overlay">
      <div className="card modal-container">
        <div className="flex-between modal-header">
          <span className="font-semibold">{isEditing ? "Editar Memória" : "Nova Memória"}</span>
          <button onClick={onClose} className="btn btn-sm" style={{ padding: "2px 8px", fontSize: 16 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="modal-form-row">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Nome</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>
            <div className="modal-form-row" style={{ gap: "8px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Tipo</label>
                <select value={type} onChange={(e) => setType(e.target.value as MemoryType)} className="select">
                  <option value="feedback">feedback</option>
                  <option value="project">project</option>
                  <option value="user">user</option>
                  <option value="reference">reference</option>
                </select>
              </div>
              {!isEditing && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Projeto</label>
                  <select value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)} className="select">
                    {projects.map((p) => (
                      <option key={p.slug} value={p.slug}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Descrição</label>
            <input required value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <label className="form-label">Body</label>
            <div className="split-view" style={{ flex: 1, minHeight: "220px" }}>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="textarea"
                style={{ height: "100%", minHeight: "220px" }}
              />
              <div
                className="markdown-content modal-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
              />
            </div>
          </div>

          <div className="flex-between modal-footer">
            <div>
              {isEditing && onDelete && (
                confirmDelete ? (
                  <div className="flex-row">
                    <span style={{ color: "var(--error)", fontSize: "13px" }}>Confirmar exclusão?</span>
                    <button type="button" onClick={() => onDelete(memory!.id)} className="btn btn-sm btn-danger">
                      Deletar
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-sm">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-sm btn-ghost-danger">
                    Deletar
                  </button>
                )
              )}
            </div>
            <div className="flex-row">
              <button type="button" onClick={onClose} className="btn btn-sm">Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm">Salvar</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
