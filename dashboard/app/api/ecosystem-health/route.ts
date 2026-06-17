import { NextResponse } from "next/server";
import { spawnPsql } from "../sessions/pg";

export const dynamic = "force-dynamic";

// Snapshot da saúde do ecossistema (braion.health_status). Escritor único é o
// avaliador no mcpgw; aqui só lemos. Degradação graciosa: tabela inexistente
// (42P01), psql ausente ou PG fora → HTTP 200 com lista vazia + error, nunca 500.
export async function GET() {
  try {
    const raw = (await spawnPsql(
      "SELECT coalesce(json_agg(h ORDER BY component), '[]'::json) " +
      "FROM braion.health_status h;"
    )).trim();
    const components = raw ? JSON.parse(raw) : [];
    return NextResponse.json({ components });
  } catch (err) {
    return NextResponse.json({ components: [], error: String(err) });
  }
}
