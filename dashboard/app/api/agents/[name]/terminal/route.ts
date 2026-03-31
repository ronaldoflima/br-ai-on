import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  let allSessions: string[] = [];
  try {
    const out = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
    });
    allSessions = out
      .trim()
      .split("\n")
      .filter((s) => s.startsWith(`hawkai-${name}`));
  } catch {
    return NextResponse.json({ sessions: [] });
  }

  if (allSessions.length === 0) {
    return NextResponse.json({ sessions: [] });
  }

  const sessions = allSessions.map((session) => {
    let output = "";
    try {
      output = execSync(`tmux capture-pane -t '${session}' -p -S -200 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 3000,
      });
    } catch {
      output = "(erro ao capturar pane)";
    }
    return { session, output: output.trimEnd() };
  });

  return NextResponse.json({ sessions });
}
