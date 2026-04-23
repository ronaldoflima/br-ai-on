export interface ConfigError {
  field: string;
  message: string;
}

export interface AgentStatus {
  name: string;
  displayName: string;
  domain: string[];
  state: "running" | "idle" | "stale" | "maintenance" | "error";
  heartbeat: string | null;
  lastRun: string | null;
  nextRun: string | null;
  objective: string | null;
  version: string;
  scheduleMode: "alive" | "handoff-only" | "disabled";
  model: string;
}

export interface DayMetrics {
  date?: string;
  total_requests: number;
  success: number;
  errors: number;
  avg_latency_ms: number;
  by_agent: AgentMetrics[];
}

export interface AgentMetrics {
  agent: string;
  requests: number;
  success: number;
  errors: number;
  avg_latency_ms: number;
}

export interface LogEntry {
  timestamp: string;
  agent: string;
  action: string;
  message: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface Handoff {
  id: string;
  from: string;
  to: string;
  created: string;
  status: string;
  expects: string;
  reply_to: string | null;
  thread_id?: string | null;
  description: string;
  body: string;
  filename: string;
}

export interface AgentSummary {
  name: string;
  display_name: string;
  domain: string[];
  version: string;
  schedule_interval: string;
  schedule_mode: "alive" | "handoff-only" | "disabled";
  model: string;
  layer: string;
  _searchText?: string;
}

export interface AgentDetail {
  name: string;
  config: Record<string, unknown>;
  configRaw: string;
  soul: string;
  objective: string;
  decisions: string;
  semantic: string;
  episodic: EpisodicEntry[];
  heartbeat: Record<string, unknown>;
  isDefault?: boolean;
  hasOverride?: boolean;
}

export interface EpisodicEntry {
  date: string;
  timestamp: string;
  action: string;
  context: string;
  outcome: string;
  importance: number;
}

export type KnowledgeType = 'insight' | 'decision' | 'fact' | 'procedure'
export type KnowledgeSource = 'agent-session' | 'manual' | 'handoff'

export interface KnowledgeEntry {
  id: string
  text: string
  agent: string
  domain: string[]
  type: KnowledgeType
  source: KnowledgeSource
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

export interface KnowledgeSearchResult extends KnowledgeEntry {
  score: number
}

export interface KnowledgeSearchFilters {
  agent?: string
  domain?: string
  type?: KnowledgeType
}

export interface KnowledgeListFilters extends KnowledgeSearchFilters {
  limit?: number
  offset?: string
}

export interface CreateKnowledgeInput {
  text: string
  agent: string
  domain: string[]
  type: KnowledgeType
  source: KnowledgeSource
  metadata?: Record<string, unknown>
}

export interface UpdateKnowledgeInput {
  text?: string
  agent?: string
  domain?: string[]
  type?: KnowledgeType
  metadata?: Record<string, unknown>
}
