import { NextRequest } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[a-zA-Z0-9_:.-]+$/;
const CURSOR_MARKER = "\uE000";

function spawnTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tmux", args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("close", (code) => {
      if (code !== 0 && !out) reject(new Error(err));
      else resolve(out);
    });
  });
}

async function capturePane(session: string, lines: number): Promise<string> {
  try {
    return await spawnTmux(["capture-pane", "-pet", session, "-S", `-${lines}`]);
  } catch {
    return "";
  }
}

async function getCursorInfo(session: string): Promise<{ x: number; y: number; paneHeight: number } | null> {
  try {
    const raw = (await spawnTmux(["display-message", "-t", session, "-p", "#{cursor_x} #{cursor_y} #{pane_height}"])).trim();
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
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = trimmed.split("\n");
  const visibleStart = Math.max(0, lines.length - cursor.paneHeight);
  const lineIndex = visibleStart + cursor.y;

  while (lineIndex >= lines.length) {
    lines.push("");
  }

  const line = lines[lineIndex];

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

async function captureWithCursor(session: string, lines: number): Promise<string> {
  const text = await capturePane(session, lines);
  const cursor = await getCursorInfo(session);
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

      captureWithCursor(session, lines).then((initial) => {
        lastOutput = initial;
        send("output", JSON.stringify(initial));
      });

      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return; }
        captureWithCursor(session, lines).then((current) => {
          if (current !== lastOutput) {
            lastOutput = current;
            send("output", JSON.stringify(current));
          }
        });
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
