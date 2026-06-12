// POST /api/sessions/action — enfileira um prompt para um pane tmux em
// braion.tmux_actions. A entrega real é do coletor do host (gate de estado:
// só claude_waiting_input/claude_idle; expiry 10min; sweep do watcher) —
// exatamente o fluxo do nudge via Telegram da fase 4.
import { NextResponse } from "next/server";
import { spawnPsqlStdin } from "../pg";
import { validateActionBody } from "./validate";

export const dynamic = "force-dynamic";

const INSERT = `INSERT INTO braion.tmux_actions
  (host, session, window_index, pane_index, action_text, requested_by)
VALUES (:'host', :'session', :'window_index'::int, :'pane_index'::int, :'text', 'dashboard')
RETURNING id;`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const v = validateActionBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const out = (
      await spawnPsqlStdin(INSERT, {
        host: v.value.host,
        session: v.value.session,
        window_index: String(v.value.window_index),
        pane_index: String(v.value.pane_index),
        text: v.value.text,
      })
    ).trim();
    // Primeira linha = valor do RETURNING (defensivo caso algum psql ainda
    // emita command tag).
    const id = Number(out.split("\n")[0]);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: `retorno inesperado do psql: ${out}` }, { status: 502 });
    }
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
