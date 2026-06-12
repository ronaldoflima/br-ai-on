"use client";
import { useEffect, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { relativeTime, cn } from "../lib/utils";
import styles from "./queue.module.css";

interface QueueTask {
  task_key: string;
  title: string;
  status: string;
  prioridade: string | null;
  score: number;
  rank: number | null;
  projeto: string | null;
  due: string | null;
  origem: string | null;
  source_path: string;
  updated_at: string;
}

const POLL_MS = 30000;

const PRIORIDADE_BADGE: Record<string, string> = {
  alta: styles.prioAlta,
  media: styles.prioMedia,
  baixa: styles.prioBaixa,
};

function dueVencido(due: string | null): boolean {
  if (!due) return false;
  return new Date(due + "T23:59:59") < new Date();
}

export default function QueuePage() {
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: AbortController | null = null;
    const fetchQueue = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/queue", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setTasks(data.tasks || []);
          setError(data.error || "");
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Erro de conexão com a API");
          setLoading(false);
        });
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, POLL_MS);
    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const ativas = tasks.filter((t) => t.rank !== null);
  const done = tasks.filter((t) => t.rank === null);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Fila de prioridades</h1>
        <span className="text-muted-xs">
          fonte: vault Obsidian (geral/br-ai-on) — atualize com /fila
        </span>
      </div>

      {error && <div className={cn(styles.errorBox, "mb-md")}>{error}</div>}

      {loading ? (
        <SkeletonCards count={4} />
      ) : ativas.length === 0 ? (
        <div className={styles.empty}>
          Nenhuma task pendente. Crie notas em geral/br-ai-on/tasks/ no Obsidian
          e rode o queue_sync.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Task</th>
              <th>Status</th>
              <th>Prioridade</th>
              <th>Score</th>
              <th>Projeto</th>
              <th>Due</th>
              <th>Atualizada</th>
            </tr>
          </thead>
          <tbody>
            {ativas.map((t) => (
              <tr key={t.task_key} className={cn(dueVencido(t.due) && styles.vencida)}>
                <td className={styles.rank}>{t.rank}</td>
                <td>
                  <div className={styles.title}>{t.title}</div>
                  <div className={styles.path}>{t.source_path}</div>
                </td>
                <td>{t.status}</td>
                <td>
                  <span className={cn(styles.badge, PRIORIDADE_BADGE[t.prioridade || ""] || styles.prioNone)}>
                    {t.prioridade || "—"}
                  </span>
                </td>
                <td className={styles.score}>{t.score}</td>
                <td>{t.projeto || "—"}</td>
                <td>{t.due ? (dueVencido(t.due) ? `⚠️ ${t.due}` : t.due) : "—"}</td>
                <td className={styles.updated}>{relativeTime(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {done.length > 0 && (
        <div className={styles.doneNote}>
          {done.length} task(s) done espelhada(s) fora da fila.
        </div>
      )}
    </div>
  );
}
