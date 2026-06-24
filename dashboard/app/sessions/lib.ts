// Tipos e helpers puros da página /sessions — sem imports de React/Next para
// rodarem direto com `node --test` (type stripping do Node 24).

export interface TmuxPane {
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
  hook_state?: string | null;
  hook_detail?: string | null;
  hook_event?: string | null;
  hook_event_at?: string | null;
}

export interface TmuxAction {
  id: number;
  host: string;
  session: string;
  window_index: number;
  pane_index: number;
  action_text: string;
  status: string; // pending|done|error|expired
  result: string | null;
  created_at: string;
}

// Visão efetiva do pane: o hook (preciso, evento de ciclo de vida do Claude
// Code) ganha da heurística quando é mais recente que a última transição
// observada pelo coletor; senão a heurística segue como rede de segurança.
export interface PaneView {
  state: string;
  since: string;
  detail: string | null;
  source: "hook" | "heurística";
}

export function effectiveView(p: TmuxPane): PaneView {
  const hookWins =
    p.hook_state &&
    p.hook_event_at &&
    new Date(p.hook_event_at).getTime() >= new Date(p.state_since).getTime();
  return hookWins
    ? { state: p.hook_state!, since: p.hook_event_at!, detail: p.hook_detail ?? null, source: "hook" }
    : { state: p.state, since: p.state_since, detail: p.state_detail, source: "heurística" };
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
// Linha "decorativa": só box-drawing, separadores e espaços.
const DECORATIVE_RE = /^[\s─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╌╍┄┅•·=\-_~*]*$/;

export function cleanOutput(raw: string | null, maxLines: number): string[] {
  if (!raw) return [];
  const lines = raw
    .replace(ANSI_RE, "")
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter((l) => l.length > 0 && !DECORATIVE_RE.test(l));
  return lines.slice(-maxLines);
}

export function projectName(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

const STATE_ORDER = ["claude_working", "claude_waiting_input", "claude_idle", "shell"];

export function stateRank(state: string): number {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.length - 1 : i;
}

export function latestActionFor(
  p: TmuxPane,
  actions: TmuxAction[],
): TmuxAction | undefined {
  return actions
    .filter(
      (a) =>
        a.host === p.host &&
        a.session === p.session &&
        a.window_index === p.window_index &&
        a.pane_index === p.pane_index,
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

const ACTIVE_STATES = ["claude_working", "claude_waiting_input"];

export function isActiveState(state: string): boolean {
  return ACTIVE_STATES.includes(state);
}

export function matchesQuery(p: TmuxPane, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [p.host, p.session, p.window_name ?? "", projectName(p.cwd) ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function whatsHappening(p: TmuxPane): string | null {
  const view = effectiveView(p);
  if (view.detail) return view.detail;
  return cleanOutput(p.last_output, 1)[0] ?? null;
}
