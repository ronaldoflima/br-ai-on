import Link from "next/link";
import type { AgentStatus } from "../lib/types";
import { relativeTime } from "../lib/utils";

const stateConfig: Record<string, { label: string; color: string }> = {
  running: { label: "Executando", color: "var(--success)" },
  idle: { label: "Idle", color: "var(--text-muted)" },
  stale: { label: "Inativo", color: "var(--warning)" },
  maintenance: { label: "Manutenção", color: "var(--warning)" },
  error: { label: "Erro", color: "var(--error)" },
};

export function AgentCard({ agent }: { agent: AgentStatus }) {
  const cfg = stateConfig[agent.state] || stateConfig.idle;

  return (
    <Link href={`/agents/${agent.name}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card pointer" style={{ borderColor: `${cfg.color}33`, transition: "border-color 0.15s" }}>
        <div className="flex-between mb-md">
          <div className="flex-row">
            <span className={`status-dot ${agent.state}`} />
            <span className="font-semibold" style={{ fontSize: 15 }}>{agent.displayName}</span>
            <span className="text-muted-xs">v{agent.version}</span>
          </div>
          <span className="text-muted-xs text-uppercase" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <div className="text-secondary-sm mb-sm">{agent.domain}</div>
        {agent.objective && (
          <div className="text-muted-sm mb-md" style={{ lineHeight: 1.4 }}>
            {agent.objective.slice(0, 100)}
          </div>
        )}
        <div className="flex-between mt-sm">
          <div>
            <span className="text-muted-xs">
              {agent.lastRun && <>Última: {relativeTime(agent.lastRun)}</>}
            </span>
            {agent.nextRun && (
              <span className="text-muted-xs" style={{ marginLeft: 12 }}>
                Próxima: {relativeTime(agent.nextRun)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
