import { NextRequest, NextResponse } from "next/server"
import { searchEntries } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.query) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      )
    }
    const filters = {
      agent: body.agent || undefined,
      domain: body.domain || undefined,
      type: body.type || undefined,
    }
    const limit = body.limit || 10
    const results = await searchEntries(body.query, filters, limit)
    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json(
      { error: "Search failed: " + String(err) },
      { status: 500 }
    )
  }
}
