import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[a-zA-Z0-9_:.-]+$/;

function safeSession(name: string | null): string | null {
  if (!name || !SESSION_RE.test(name)) return null;
  return name;
}

export async function GET(req: NextRequest) {
  const session = safeSession(req.nextUrl.searchParams.get("session"));

  if (!session) {
    try {
      const out = execSync("tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_activity}' 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      if (!out) return NextResponse.json([]);

      const sessions = out.split("\n").map((line) => {
        const [name, windows, attached, activity] = line.split("\t");
        return {
          name,
          windows: parseInt(windows) || 1,
          attached: attached === "1",
          activity: parseInt(activity) ? new Date(parseInt(activity) * 1000).toISOString() : null,
        };
      });

      return NextResponse.json(sessions);
    } catch {
      return NextResponse.json([]);
    }
  }

  try {
    const output = execSync(`tmux capture-pane -pet '${session}' -S -500 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    return NextResponse.json({ session, output });
  } catch {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }
}

const ALLOWED_KEYS = new Set([
  "Enter", "Up", "Down", "Left", "Right",
  "Tab", "BTab",
  "C-b", "C-c", "C-e", "C-t",
  "Escape",
]);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const session = safeSession(body.session);

  if (!session) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });

  if (body.key !== undefined) {
    const key: string = body.key;
    if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: "Tecla inválida" }, { status: 400 });
    try {
      execSync(`tmux send-keys -t '${session}' '${key}' 2>/dev/null`, { timeout: 5000 });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Falha ao enviar tecla" }, { status: 500 });
    }
  }

  const text: string = body.text ?? "";
  if (typeof text !== "string") return NextResponse.json({ error: "Texto inválido" }, { status: 400 });

  try {
    execSync(`tmux send-keys -t '${session}' ${JSON.stringify(text)} Enter 2>/dev/null`, {
      timeout: 5000,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao enviar teclas" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const name = safeSession(body.name);
  if (!name) return NextResponse.json({ error: "Nome de sessão inválido" }, { status: 400 });

  try {
    execSync(`tmux new-session -d -s '${name}' 2>/dev/null`, { timeout: 5000 });
    return NextResponse.json({ ok: true, name });
  } catch {
    return NextResponse.json({ error: "Falha ao criar sessão" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = safeSession(req.nextUrl.searchParams.get("session"));
  if (!session) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });

  try {
    execSync(`tmux kill-session -t '${session}' 2>/dev/null`, { timeout: 5000 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao matar sessão" }, { status: 500 });
  }
}
