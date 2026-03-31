import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { scanMemoryProjects } from "../../../lib/memory-scanner";
import {
  findMemoryById,
  generateFileName,
  writeMemoryFile,
  parseMemoryFile,
  createBackup,
  MemoryType,
} from "../../../lib/memory-parser";
import { reconcileIndex } from "../../../lib/memory-index";

async function findAcrossProjects(id: string) {
  const scanned = await scanMemoryProjects();
  for (const project of scanned) {
    const result = await findMemoryById(project.memoryPath, project.slug, id);
    if (result) return { ...result, memoryPath: project.memoryPath };
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await findAcrossProjects(id);
    if (!result) return NextResponse.json({ error: "NOT_FOUND", message: "Memory not found" }, { status: 404 });
    return NextResponse.json(result.memory);
  } catch (error) {
    return NextResponse.json({ error: "SERVER_ERROR", message: String(error) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await findAcrossProjects(id);
    if (!result) return NextResponse.json({ error: "NOT_FOUND", message: "Memory not found" }, { status: 404 });

    const body = await request.json();
    const newName = body.name ?? result.memory.name;
    const newDescription = body.description ?? result.memory.description;
    const newType = (body.type ?? result.memory.type) as MemoryType;
    const newBody = body.body ?? result.memory.body;

    await createBackup(result.filePath);

    const newFileName = generateFileName(newType, newName);
    const oldFileName = path.basename(result.filePath);
    let targetPath = result.filePath;

    if (newFileName !== oldFileName) {
      targetPath = path.join(path.dirname(result.filePath), newFileName);
      try {
        await fs.access(targetPath);
        return NextResponse.json({ error: "CONFLICT", message: `File already exists: ${newFileName}` }, { status: 409 });
      } catch { /* no collision */ }
      await fs.unlink(result.filePath);
    }

    await writeMemoryFile(targetPath, newName, newDescription, newType, newBody);
    await reconcileIndex(result.memoryPath);
    const updated = await parseMemoryFile(targetPath, result.memory.projectSlug);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: "SERVER_ERROR", message: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await findAcrossProjects(id);
    if (!result) return NextResponse.json({ error: "NOT_FOUND", message: "Memory not found" }, { status: 404 });

    await createBackup(result.filePath);
    await fs.unlink(result.filePath);
    await reconcileIndex(result.memoryPath);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: "SERVER_ERROR", message: String(error) }, { status: 500 });
  }
}
