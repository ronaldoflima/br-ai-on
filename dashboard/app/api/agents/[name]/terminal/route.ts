import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  let allSessions: string[] = [];
  try {
    const out = await spawnTmux(["list-sessions", "-F", "#{session_name}"]);
    allSessions = out
      .trim()
      .split("\n")
      .filter((s) => s.startsWith(`braion-${name}`));
  } catch {
    return NextResponse.json({ sessions: [] });
  }

  if (allSessions.length === 0) {
    return NextResponse.json({ sessions: [] });
  }

  const sessions = await Promise.all(
    allSessions.map(async (session) => {
      let output = "";
      try {
        output = await spawnTmux(["capture-pane", "-t", session, "-p", "-S", "-200"]);
      } catch {
        output = "(erro ao capturar pane)";
      }
      return { session, output: output.trimEnd() };
    })
  );

  return NextResponse.json({ sessions });
}
