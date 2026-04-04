import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

export const dynamic = "force-dynamic";

interface ArtifactFile {
  name: string;
  size: number;
  modified: string;
  type: string;
}

function getFileType(name: string): string {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".md": "markdown",
    ".json": "json",
    ".jsonl": "jsonl",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".txt": "text",
    ".csv": "csv",
    ".sh": "shell",
    ".ts": "typescript",
    ".js": "javascript",
    ".py": "python",
    ".html": "html",
    ".css": "css",
    ".log": "log",
  };
  return map[ext] || "file";
}

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent");
  const id = request.nextUrl.searchParams.get("id");
  const file = request.nextUrl.searchParams.get("file");

  if (!agent || !id) {
    return NextResponse.json({ error: "agent e id obrigatórios" }, { status: 400 });
  }

  const artifactsDir = join(AGENTS_DIR, agent, "handoffs", "artifacts", id);

  if (!existsSync(artifactsDir)) {
    return NextResponse.json({ files: [] });
  }

  if (file) {
    const filePath = join(artifactsDir, file);
    if (!filePath.startsWith(artifactsDir) || !existsSync(filePath)) {
      return NextResponse.json({ error: "arquivo não encontrado" }, { status: 404 });
    }
    const content = readFileSync(filePath, "utf-8");
    return NextResponse.json({ name: file, content, type: getFileType(file) });
  }

  const entries = readdirSync(artifactsDir).filter((f) => !f.startsWith("."));
  const files: ArtifactFile[] = entries.map((name) => {
    const st = statSync(join(artifactsDir, name));
    return {
      name,
      size: st.size,
      modified: st.mtime.toISOString(),
      type: getFileType(name),
    };
  });

  files.sort((a, b) => b.modified.localeCompare(a.modified));

  return NextResponse.json({ id, agent, files });
}
