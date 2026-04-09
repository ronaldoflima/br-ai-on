"use client";
import { useEffect, useState } from "react";

type AgentEntry = { name: string; display_name: string; schedule_mode: string; domain: string[]; layer: string };

let cachedAgents: AgentEntry[] | null = null;

export function useAgentList(activeOnly = false): string[] {
  const [agents, setAgents] = useState<AgentEntry[]>(cachedAgents || []);

  useEffect(() => {
    if (cachedAgents) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: AgentEntry[]) => {
        cachedAgents = data;
        setAgents(data);
      })
      .catch(() => {});
  }, []);

  const filtered = activeOnly ? agents.filter((a) => a.schedule_mode === "alive") : agents;
  return filtered.map((a) => a.name);
}

export function useAgentListFull(activeOnly = false): AgentEntry[] {
  const [agents, setAgents] = useState<AgentEntry[]>(cachedAgents || []);

  useEffect(() => {
    if (cachedAgents) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: AgentEntry[]) => {
        cachedAgents = data;
        setAgents(data);
      })
      .catch(() => {});
  }, []);

  return activeOnly ? agents.filter((a) => a.schedule_mode === "alive") : agents;
}
