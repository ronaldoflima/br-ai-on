import { NextRequest, NextResponse } from "next/server"
import { getEntry, updateEntry, deleteEntry } from "@/lib/knowledge"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["insight", "decision", "fact", "procedure"]

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const entry = await getEntry(id)
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
    await updateEntry(id, body)
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteEntry(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete entry: " + String(err) },
      { status: 500 }
    )
  }
}
