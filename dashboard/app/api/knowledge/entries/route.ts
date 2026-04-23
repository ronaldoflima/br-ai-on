import { NextRequest, NextResponse } from "next/server"
import { createEntry, listEntries } from "@/lib/knowledge"
import type { CreateKnowledgeInput } from "@/app/lib/types"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["insight", "decision", "fact", "procedure"]
const VALID_SOURCES = ["agent-session", "manual", "handoff"]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.text || !body.agent || !body.type) {
      return NextResponse.json(
        { error: "text, agent, and type are required" },
        { status: 400 }
      )
    }
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }
    if (body.source && !VALID_SOURCES.includes(body.source)) {
      return NextResponse.json(
        { error: `source must be one of: ${VALID_SOURCES.join(", ")}` },
        { status: 400 }
      )
    }
    const input: CreateKnowledgeInput = {
      text: body.text,
      agent: body.agent,
      domain: body.domain || [],
      type: body.type,
      source: body.source || "manual",
      metadata: body.metadata || {},
    }
    const collection = body.collection || undefined
    const id = await createEntry(input, collection)
    return NextResponse.json({ ok: true, id }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create entry: " + String(err) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const filters = {
      agent: params.get("agent") || undefined,
      domain: params.get("domain") || undefined,
      type: params.get("type") as CreateKnowledgeInput["type"] | undefined,
    }
    const limit = parseInt(params.get("limit") || "20", 10)
    const offset = params.get("offset") || undefined
    const collection = params.get("collection") || undefined

    const result = await listEntries(filters, limit, offset, collection)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list entries: " + String(err) },
      { status: 500 }
    )
  }
}
