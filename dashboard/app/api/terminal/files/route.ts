import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname, resolve } from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[a-zA-Z0-9_:.-]+$/;
const MAX_FILE_SIZE = 1 * 1024 * 1024;

const ALLOWED_BASES = [
  join(process.cwd(), ".."),
  join(process.cwd(), "..", "agents"),
  join(process.cwd(), "..", "logs"),
  "/tmp",
];

function spawnTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tmux", args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("close", (code) => {
      if (code !== 0 && !out) reject(new Error(err));
      else resolve(out);
    });
  });
}

function safeSession(name: string | null): string | null {
  if (!name || !SESSION_RE.test(name)) return null;
  return name;
}

function isAllowedPath(p: string): boolean {
  const resolved = resolve(p);
  return ALLOWED_BASES.some((base) => resolved.startsWith(resolve(base) + "/") || resolved === resolve(base));
}

function getFileType(name: string): string {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".md": "markdown", ".json": "json", ".jsonl": "jsonl",
    ".yaml": "yaml", ".yml": "yaml", ".txt": "text",
    ".csv": "csv", ".sh": "shell", ".ts": "typescript",
    ".js": "javascript", ".tsx": "tsx", ".jsx": "jsx",
    ".py": "python", ".html": "html", ".css": "css",
    ".log": "log", ".env": "env", ".toml": "toml",
    ".xml": "xml", ".sql": "sql",
  };
  return map[ext] || "file";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function GET(request: NextRequest) {
  const sessionParam = safeSession(request.nextUrl.searchParams.get("session"));
  const pathParam = request.nextUrl.searchParams.get("path");
  const fileParam = request.nextUrl.searchParams.get("file");
  const download = request.nextUrl.searchParams.get("download") === "1";

  if (!sessionParam) {
    return NextResponse.json({ error: "session obrigatório" }, { status: 400 });
  }

  let dirPath = pathParam;
  if (!dirPath) {
    try {
      dirPath = (await spawnTmux(["display-message", "-p", "-t", sessionParam, "#{pane_current_path}"])).trim();
    } catch {
      return NextResponse.json({ error: "Não foi possível obter o diretório da sessão" }, { status: 500 });
    }
  }

  if (!dirPath || !existsSync(dirPath)) {
    return NextResponse.json({ error: "Diretório não encontrado" }, { status: 404 });
  }

  const resolvedDir = resolve(dirPath);

  if (pathParam && !isAllowedPath(resolvedDir)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  if (fileParam) {
    const filePath = resolve(join(resolvedDir, fileParam));
    if (!filePath.startsWith(resolvedDir + "/") && filePath !== resolvedDir) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
    }
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: "É um diretório" }, { status: 400 });
    }
    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Arquivo muito grande (máx 1MB)` }, { status: 413 });
    }

    if (download) {
      const buffer = readFileSync(filePath);
      return new NextResponse(buffer, {
        headers: {
          "Content-Disposition": `attachment; filename="${fileParam}"`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(stat.size),
        },
      });
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      return NextResponse.json({ name: fileParam, content, type: getFileType(fileParam), size: stat.size });
    } catch {
      return NextResponse.json({ error: "Arquivo binário ou não legível como texto" }, { status: 415 });
    }
  }

  try {
    const entries = readdirSync(resolvedDir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .slice(0, 500);

    const items = entries.map((e) => {
      const fullPath = join(resolvedDir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const target = statSync(fullPath);
          isDir = target.isDirectory();
          isFile = target.isFile();
        } catch {}
      }
      let size = 0;
      try { if (isFile) size = statSync(fullPath).size; } catch {}
      return {
        name: e.name,
        isDir,
        size,
        sizeFormatted: isFile ? formatSize(size) : "",
        type: isDir ? "dir" : getFileType(e.name),
      };
    }).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ path: resolvedDir, items });
  } catch {
    return NextResponse.json({ error: "Erro ao listar diretório" }, { status: 500 });
  }
}
