import { NextResponse } from "next/server";
import { spawnPsql } from "./pg";

export const dynamic = "force-dynamic";

const STALE_MS = 3 * 60 * 1000;

// Uma única invocação de psql devolve as duas tabelas num único JSON.
const QUERY = `SELECT json_build_object(
  'sessions', (
    SELECT coalesce(json_agg(t ORDER BY t.host, t.session, t.window_index, t.pane_index), '[]'::json)
    FROM braion.tmux_sessions t
  ),
  'hosts', (
    SELECT coalesce(json_agg(h ORDER BY h.host), '[]'::json)
    FROM braion.collector_heartbeats h
  )
)`;

interface TmuxPane {
  host: string;
  session: string;
  window_index: number;
  pane_index: number;
  window_name: string | null;
  command: string | null;
  cwd: string | null;
  state: string;
  state_detail: string | null;
  last_output: string | null;
  attached: boolean;
  state_since: string;
  last_seen: string;
  // Colunas hook_* (migration 0005): a QUERY agrega a linha inteira via
  // json_agg(t), então elas fluem automaticamente quando existem — e ficam
  // ausentes do JSON (undefined) enquanto a migration não foi aplicada.
  hook_state?: string | null;
  hook_detail?: string | null;
  hook_event?: string | null;
  hook_event_at?: string | null;
}

interface HeartbeatRow {
  host: string;
  last_run: string;
}

export async function GET() {
  // Degradação graciosa: tabela inexistente (42P01), psql ausente ou PG fora do
  // ar → HTTP 200 com listas vazias + error, nunca 500 (não quebra o dashboard).
  try {
    const out = (await spawnPsql(QUERY)).trim();
    const data = out ? JSON.parse(out) : { sessions: [], hosts: [] };
    const sessions: TmuxPane[] = data.sessions || [];
    const hosts = ((data.hosts || []) as HeartbeatRow[]).map((h) => ({
      host: h.host,
      last_run: h.last_run,
      online: Date.now() - new Date(h.last_run).getTime() <= STALE_MS,
    }));
    return NextResponse.json({ sessions, hosts });
  } catch (err) {
    return NextResponse.json({ sessions: [], hosts: [], error: String(err) });
  }
}
