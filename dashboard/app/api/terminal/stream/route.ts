import { NextRequest } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[a-zA-Z0-9_:.-]+$/;
const CURSOR_MARKER = "\uE000";

function capturePane(session: string, lines: number): string {
  try {
    return execSync(`tmux capture-pane -pet '${session}' -S -${lines} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

function getCursorInfo(session: string): { x: number; y: number; paneHeight: number } | null {
  try {
    const raw = execSync(
      `tmux display-message -t '${session}' -p "#{cursor_x} #{cursor_y} #{pane_height}" 2>/dev/null`,
      { encoding: "utf-8", timeout: 2000 }
    ).trim();
    const parts = raw.split(" ").map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return { x: parts[0], y: parts[1], paneHeight: parts[2] };
    }
    return null;
  } catch {
    return null;
  }
}

function insertCursorMarker(
  text: string,
  cursor: { x: number; y: number; paneHeight: number }
): string {
  const lines = text.split("\n");
  const visibleStart = Math.max(0, lines.length - cursor.paneHeight);
  const lineIndex = visibleStart + cursor.y;

  // Pad with empty lines when cursor is past captured text
  while (lineIndex >= lines.length) {
    lines.push("");
  }

  const line = lines[lineIndex];

  // Walk through line counting visible chars (skipping ANSI sequences)
  let visibleCount = 0;
  let i = 0;
  let insertPos = line.length;

  while (i < line.length) {
    if (line[i] === "\x1b") {
      const match = line.slice(i).match(/^\x1b\[[0-9;?]*[a-zA-Z]/);
      if (match) { i += match[0].length; continue; }
    }
    if (visibleCount === cursor.x) { insertPos = i; break; }
    visibleCount++;
    i++;
  }

  lines[lineIndex] = line.slice(0, insertPos) + CURSOR_MARKER + line.slice(insertPos);
  return lines.join("\n");
}

function captureWithCursor(session: string, lines: number): string {
  const text = capturePane(session, lines);
  const cursor = getCursorInfo(session);
  if (!cursor) return text;
  return insertCursorMarker(text, cursor);
}

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session");
  if (!session || !SESSION_RE.test(session)) {
    return new Response("Sessão inválida", { status: 400 });
  }
  const lines = Math.max(10, Math.min(2000, parseInt(req.nextUrl.searchParams.get("lines") ?? "100") || 100));
  const rate = Math.max(100, Math.min(10000, parseInt(req.nextUrl.searchParams.get("rate") ?? "300") || 300));

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      let lastOutput = "";

      function send(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      }

      const initial = captureWithCursor(session, lines);
      lastOutput = initial;
      send("output", JSON.stringify(initial));

      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return; }
        const current = captureWithCursor(session, lines);
        if (current !== lastOutput) {
          lastOutput = current;
          send("output", JSON.stringify(current));
        }
      }, rate);

      const keepalive = setInterval(() => {
        if (closed) { clearInterval(keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        clearInterval(keepalive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
