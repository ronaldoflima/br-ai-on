import { NextRequest, NextResponse } from "next/server";
import { validateAgentConfig } from "../../../../lib/config-validator";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { config } = await request.json();
    if (typeof config !== "string") {
      return NextResponse.json({ error: "config deve ser string YAML" }, { status: 400 });
    }
    const result = validateAgentConfig(config);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Erro ao validar" }, { status: 500 });
  }
}
