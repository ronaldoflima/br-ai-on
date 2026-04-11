// dashboard/app/api/agents/[name]/config-history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listConfigHistory, getConfigHistoryVersion } from "../../../../lib/config-history";
import { resolveAgentDir } from "../../../../lib/agents";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);
  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const timestamp = searchParams.get("timestamp");

  if (timestamp) {
    const content = getConfigHistoryVersion(resolved.dir, timestamp);
    if (!content) {
      return NextResponse.json({ error: "versão não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ content });
  }

  const versions = listConfigHistory(resolved.dir);
  return NextResponse.json({ versions });
}
