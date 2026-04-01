import { NextRequest } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[a-zA-Z0-9_:.-]+$/;

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

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session");
  if (!session || !SESSION_RE.test(session)) {
    return new Response("Sessão inválida", { status: 400 });
  }
  const lines = Math.max(10, Math.min(2000, parseInt(req.nextUrl.searchParams.get("lines") ?? "100") || 100));

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      let lastOutput = "";

      function send(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      }

      // Envia output inicial imediatamente
      const initial = capturePane(session, lines);
      lastOutput = initial;
      send("output", JSON.stringify(initial));

      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }
        const current = capturePane(session, lines);
        if (current !== lastOutput) {
          lastOutput = current;
          send("output", JSON.stringify(current));
        }
      }, 300);

      // Keepalive a cada 15s para evitar timeout do proxy/browser
      const keepalive = setInterval(() => {
        if (closed) {
          clearInterval(keepalive);
          return;
        }
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
