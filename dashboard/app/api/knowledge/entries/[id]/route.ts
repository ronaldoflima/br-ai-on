import { NextRequest, NextResponse } from "next/server"
import { getEntry, updateEntry, deleteEntry } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["insight", "decision", "fact", "procedure"]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const collection = request.nextUrl.searchParams.get("collection") || undefined
    const entry = await getEntry(id, collection)
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    return NextResponse.json(entry)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to get entry: " + String(err) },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    if (body.type && !VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }
    const collection = body.collection || undefined
    await updateEntry(id, body, collection)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = String(err)
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    return NextResponse.json(
      { error: "Failed to update entry: " + msg },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const collection = request.nextUrl.searchParams.get("collection") || undefined
    await deleteEntry(id, collection)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete entry: " + String(err) },
      { status: 500 }
    )
  }
}
