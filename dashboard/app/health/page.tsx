"use client";
import { useEffect, useMemo, useState } from "react";
import { SkeletonCards } from "../components/Skeleton";
import { relativeTime, cn } from "../lib/utils";
import styles from "./health.module.css";

const POLL_MS = 15000;
// Acima disto, o avaliador (escritor único no mcpgw) provavelmente parou: o
// check mais recente está velho demais para refletir o estado real.
const STALE_EVALUATOR_MS = 6 * 60 * 1000;

type HealthStatus = "ok" | "degraded" | "down" | "unknown";

interface HealthComponent {
  component: string;
  status: HealthStatus;
  summary: string;
  detail: Record<string, unknown> | null;
  checked_at: string;
}

// Grupos por domínio, derivados do prefixo do `component`. A ordem aqui é a
// ordem de renderização das seções.
const GROUPS: { id: string; label: string; match: (c: string) => boolean }[] = [
  { id: "collectors", label: "Collectors", match: (c) => c.startsWith("collector:") },
  {
    id: "pipeline",
    label: "Pipeline Teams",
    match: (c) => c.startsWith("pipeline:") || c === "queue_sync" || c.startsWith("crawler:"),
  },
  { id: "watcher", label: "Watcher", match: (c) => c === "watcher" },
  { id: "qdrant", label: "Qdrant", match: (c) => c.startsWith("qdrant:") },
  // Infra é o catch-all: pg e qualquer coisa não categorizada acima.
  { id: "infra", label: "Infra", match: () => true },
];

const STATUS_META: Record<HealthStatus, { label: string; dot: string; card: string }> = {
  ok: { label: "ok", dot: styles.dotOk, card: styles.cardOk },
  degraded: { label: "degradado", dot: styles.dotDegraded, card: styles.cardDegraded },
  down: { label: "down", dot: styles.dotDown, card: styles.cardDown },
  unknown: { label: "desconhecido", dot: styles.dotUnknown, card: styles.cardUnknown },
};

function groupOf(component: string): string {
  for (const g of GROUPS) {
    if (g.match(component)) return g.id;
  }
  return "infra";
}

export default function HealthPage() {
  const [components, setComponents] = useState<HealthComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: AbortController | null = null;
    const fetchHealth = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/ecosystem-health", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setComponents(data.components || []);
          setError(data.error || "");
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Erro de conexão com a API");
          setLoading(false);
        });
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_MS);
    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const counts = useMemo(() => {
    const acc: Record<HealthStatus, number> = { ok: 0, degraded: 0, down: 0, unknown: 0 };
    for (const c of components) acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, [components]);

  const lastCheck = useMemo(() => {
    let max = 0;
    for (const c of components) {
      const t = new Date(c.checked_at).getTime();
      if (!Number.isNaN(t) && t > max) max = t;
    }
    return max || null;
  }, [components]);

  const evaluatorStale = lastCheck !== null && Date.now() - lastCheck > STALE_EVALUATOR_MS;

  // Seções na ordem de GROUPS, só as que têm componentes; cada uma ordenada por
  // nome para estabilidade visual entre polls.
  const sections = useMemo(() => {
    const byGroup = new Map<string, HealthComponent[]>();
    for (const c of components) {
      const g = groupOf(c.component);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(c);
    }
    return GROUPS.map((g) => ({
      ...g,
      items: (byGroup.get(g.id) || []).sort((a, b) => a.component.localeCompare(b.component)),
    })).filter((s) => s.items.length > 0);
  }, [components]);

  const allOk = counts.down === 0 && counts.degraded === 0;
  const bannerClass = error
    ? styles.bannerError
    : counts.down > 0
    ? styles.bannerDown
    : counts.degraded > 0
    ? styles.bannerDegraded
    : styles.bannerOk;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Saúde do ecossistema</h1>
        <span className="text-muted-xs">atualiza a cada 15s</span>
      </div>

      {loading ? (
        <SkeletonCards count={6} />
      ) : (
        <div className={styles.wrapper}>
          <div className={cn(styles.banner, bannerClass)}>
            <div className={styles.bannerMain}>
              {error
                ? `Falha ao avaliar: ${error}`
                : allOk
                ? "Tudo ok"
                : `${counts.down} down · ${counts.degraded} degradados`}
            </div>
            <div className={styles.bannerMeta}>
              {!error && (
                <span>
                  {components.length} componentes · {counts.ok} ok
                  {counts.unknown > 0 ? ` · ${counts.unknown} desconhecidos` : ""}
                </span>
              )}
              {lastCheck !== null && (
                <span>último check {relativeTime(new Date(lastCheck).toISOString())}</span>
              )}
            </div>
            {evaluatorStale && lastCheck !== null && (
              <div className={styles.bannerWarn}>
                avaliador possivelmente parado (último check{" "}
                {relativeTime(new Date(lastCheck).toISOString())})
              </div>
            )}
          </div>

          {sections.map((section) => (
            <section key={section.id} className={styles.group}>
              <h2 className={styles.groupTitle}>{section.label}</h2>
              <div className={styles.cardGrid}>
                {section.items.map((c) => {
                  const meta = STATUS_META[c.status] || STATUS_META.unknown;
                  const detailEntries = Object.entries(c.detail || {}).filter(
                    ([, v]) => v !== null,
                  );
                  return (
                    <div key={c.component} className={cn(styles.card, meta.card)}>
                      <div className={styles.cardHeader}>
                        <span className={cn(styles.dot, meta.dot)} />
                        <span className={styles.componentName}>{c.component}</span>
                        <span className={styles.checkedAt}>{relativeTime(c.checked_at)}</span>
                      </div>
                      {c.summary && <div className={styles.summary}>{c.summary}</div>}
                      {detailEntries.length > 0 && (
                        <div className={styles.detail}>
                          {detailEntries.map(([k, v]) => (
                            <span key={k} className={styles.detailLine}>
                              <span className={styles.detailKey}>{k}:</span> {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {sections.length === 0 && !error && (
            <div className={styles.empty}>Nenhum componente reportado pelo avaliador.</div>
          )}
        </div>
      )}
    </div>
  );
}
