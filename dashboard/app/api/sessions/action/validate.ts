// Validação pura do body do POST /api/sessions/action — sem imports de
// Next para rodar com `node --test`.

export interface ActionBody {
  host: string;
  session: string;
  window_index: number;
  pane_index: number;
  text: string;
}

export type ValidationResult =
  | { ok: true; value: ActionBody }
  | { ok: false; error: string };

const MAX_TEXT = 2000;

export function validateActionBody(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body inválido" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.host !== "string" || !b.host) return { ok: false, error: "host obrigatório" };
  if (typeof b.session !== "string" || !b.session) return { ok: false, error: "session obrigatória" };
  if (!Number.isInteger(b.window_index)) return { ok: false, error: "window_index deve ser inteiro" };
  if (!Number.isInteger(b.pane_index)) return { ok: false, error: "pane_index deve ser inteiro" };
  if (typeof b.text !== "string") return { ok: false, error: "text obrigatório" };
  const text = b.text.trim();
  if (!text) return { ok: false, error: "text vazio" };
  if (text.length > MAX_TEXT) return { ok: false, error: `text > ${MAX_TEXT} chars` };
  return {
    ok: true,
    value: {
      host: b.host,
      session: b.session,
      window_index: b.window_index as number,
      pane_index: b.pane_index as number,
      text,
    },
  };
}
