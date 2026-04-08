import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

export const dynamic = "force-dynamic";

interface Handoff {
  id: string;
  from: string;
  to: string;
  created: string;
  status: string;
  expects: string;
  reply_to: string | null;
  thread_id?: string | null;
  description: string;
  body: string;
  filename: string;
}

function parseYamlSafe(raw: string): Record<string, string> {
  try {
    return parse(raw) || {};
  } catch {
    // Fallback: quote values that contain unquoted colons
    const fixed = raw.replace(/^(\w+): (.+:.+)$/gm, (_m, key, val) =>
      val.startsWith('"') ? `${key}: ${val}` : `${key}: "${val.replace(/"/g, '\\"')}"`
    );
    try {
      return parse(fixed) || {};
    } catch {
      return {};
    }
  }
}

function parseHandoff(filePath: string, filename: string): Handoff | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    const meta = parseYamlSafe(match[1]);
    if (!meta.id && !meta.from) return null;
    const body = match[2].trim();
    const descMatch = body.match(/## Descricao\n([\s\S]*?)(?=\n## |$)/);
    return {
      id: meta.id || filename,
      from: meta.from || "",
      to: meta.to || "",
      created: meta.created || "",
      status: meta.status || "pending",
      expects: meta.expects || "",
      reply_to: meta.reply_to || null,
      thread_id: meta.thread_id || null,
      description: descMatch ? descMatch[1].trim().slice(0, 200) : "",
      body,
      filename,
    };
  } catch {
    return null;
  }
}

function collectHandoffs(agentName: string) {
  const agentDir = join(AGENTS_DIR, agentName);
  const inboxDir = join(agentDir, "handoffs", "inbox");
  const inProgressDir = join(agentDir, "handoffs", "in_progress");
  const archiveDir = join(agentDir, "handoffs", "archive");
  const inbox: Handoff[] = [];
  const in_progress: Handoff[] = [];
  const archive: Handoff[] = [];

  if (existsSync(inboxDir)) {
    for (const file of readdirSync(inboxDir).filter((f) => f.endsWith(".md"))) {
      const ho = parseHandoff(join(inboxDir, file), file);
      if (ho) inbox.push(ho);
    }
  }

  if (existsSync(inProgressDir)) {
    for (const file of readdirSync(inProgressDir).filter((f) => f.endsWith(".md"))) {
      const ho = parseHandoff(join(inProgressDir, file), file);
      if (ho) in_progress.push(ho);
    }
  }

  if (existsSync(archiveDir)) {
    for (const file of readdirSync(archiveDir).filter((f) => f.endsWith(".md"))) {
      const ho = parseHandoff(join(archiveDir, file), file);
      if (ho) archive.push(ho);
    }
  }

  return { inbox, in_progress, archive };
}

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent") || "all";

  const inbox: Handoff[] = [];
  const in_progress: Handoff[] = [];
  const archive: Handoff[] = [];

  if (agent === "all") {
    if (existsSync(AGENTS_DIR)) {
      for (const dir of readdirSync(AGENTS_DIR)) {
        const agentDir = join(AGENTS_DIR, dir);
        try {
          const stat = require("fs").statSync(agentDir);
          if (!stat.isDirectory()) continue;
        } catch { continue; }
        const result = collectHandoffs(dir);
        inbox.push(...result.inbox);
        in_progress.push(...result.in_progress);
        archive.push(...result.archive);
      }
    }
  } else {
    if (!existsSync(join(AGENTS_DIR, agent))) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }
    if (existsSync(AGENTS_DIR)) {
      for (const dir of readdirSync(AGENTS_DIR)) {
        const agentDir = join(AGENTS_DIR, dir);
        try {
          const stat = require("fs").statSync(agentDir);
          if (!stat.isDirectory()) continue;
        } catch { continue; }
        const result = collectHandoffs(dir);
        inbox.push(...result.inbox.filter((h) => h.to === agent || h.from === agent));
        in_progress.push(...result.in_progress.filter((h) => h.to === agent || h.from === agent));
        archive.push(...result.archive.filter((h) => h.to === agent || h.from === agent));
      }
    }
  }

  const dedup = (arr: Handoff[]) => {
    const seen = new Set<string>();
    return arr.filter((h) => {
      const key = `${h.id}_${h.from}_${h.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const dedupInbox = dedup(inbox);
  const dedupInProgress = dedup(in_progress);
  const dedupArchive = dedup(archive);

  dedupInbox.sort((a, b) => b.created.localeCompare(a.created));
  dedupInProgress.sort((a, b) => b.created.localeCompare(a.created));
  dedupArchive.sort((a, b) => b.created.localeCompare(a.created));

  return NextResponse.json({ agent, inbox: dedupInbox, in_progress: dedupInProgress, archive: dedupArchive });
}

function nextHandoffId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let seq = 1;
  if (existsSync(AGENTS_DIR)) {
    for (const dir of readdirSync(AGENTS_DIR)) {
      for (const sub of ["handoffs/inbox", "handoffs/archive", "handoffs/in_progress"]) {
        const d = join(AGENTS_DIR, dir, sub);
        if (!existsSync(d)) continue;
        for (const f of readdirSync(d)) {
          const m = f.match(new RegExp(`HO-${dateStr}-(\\d+)_`));
          if (m && parseInt(m[1]) >= seq) seq = parseInt(m[1]) + 1;
        }
      }
    }
  }
  return `HO-${dateStr}-${String(seq).padStart(3, "0")}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { to, expects = "action", description = "", context = "", expected = "" } = body;

  if (!to) return NextResponse.json({ error: "campo 'to' obrigatório" }, { status: 400 });

  const agentDir = join(AGENTS_DIR, to);
  if (!existsSync(agentDir)) return NextResponse.json({ error: "agente não encontrado" }, { status: 404 });

  const inboxDir = join(agentDir, "handoffs", "inbox");
  mkdirSync(inboxDir, { recursive: true });

  const id = nextHandoffId();
  const created = new Date().toISOString();
  const filename = `${id}_from-user.md`;

  const content = `---
id: ${id}
from: user
to: ${to}
created: ${created}
status: pending
expects: ${expects}
reply_to: null
---

## Descricao
${description}

## Contexto
${context}

## Esperado
${expected}
`;

  writeFileSync(join(inboxDir, filename), content, "utf-8");
  return NextResponse.json({ id, filename }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { agent, filename, expects, description, context, expected, restore } = body;

  if (!agent || !filename) return NextResponse.json({ error: "agent e filename obrigatórios" }, { status: 400 });

  const inboxPath = join(AGENTS_DIR, agent, "handoffs", "inbox", filename);
  const inProgressPath = join(AGENTS_DIR, agent, "handoffs", "in_progress", filename);
  const archivePath = join(AGENTS_DIR, agent, "handoffs", "archive", filename);

  const isInArchive = !existsSync(inboxPath) && !existsSync(inProgressPath) && existsSync(archivePath);
  const isInProgress = !existsSync(inboxPath) && existsSync(inProgressPath);
  const currentPath = isInArchive ? archivePath : isInProgress ? inProgressPath : inboxPath;

  if (!existsSync(currentPath)) return NextResponse.json({ error: "handoff não encontrado" }, { status: 404 });

  const raw = readFileSync(currentPath, "utf-8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return NextResponse.json({ error: "formato inválido" }, { status: 400 });

  const meta = parseYamlSafe(match[1]);
  const newStatus = restore ? "pending" : (meta.status || "pending");
  const updatedMeta = Object.entries({ ...meta, expects: expects || meta.expects, status: newStatus })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const updatedContent = `---\n${updatedMeta}\n---\n\n## Descricao\n${description || ""}\n\n## Contexto\n${context || ""}\n\n## Esperado\n${expected || ""}\n`;

  if ((isInArchive || isInProgress) && restore) {
    const inboxDir = join(AGENTS_DIR, agent, "handoffs", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(currentPath, updatedContent, "utf-8");
    const { renameSync } = require("fs");
    renameSync(currentPath, inboxPath);
  } else {
    writeFileSync(currentPath, updatedContent, "utf-8");
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { agent, filename } = body;

  if (!agent || !filename) return NextResponse.json({ error: "agent e filename obrigatórios" }, { status: 400 });

  const inboxPath = join(AGENTS_DIR, agent, "handoffs", "inbox", filename);
  if (!existsSync(inboxPath)) return NextResponse.json({ error: "handoff não encontrado" }, { status: 404 });

  const archiveDir = join(AGENTS_DIR, agent, "handoffs", "archive");
  mkdirSync(archiveDir, { recursive: true });

  const { renameSync } = require("fs");
  const content = readFileSync(inboxPath, "utf-8").replace(/^status: pending$/m, "status: archived");
  writeFileSync(inboxPath, content, "utf-8");
  renameSync(inboxPath, join(archiveDir, filename));

  return NextResponse.json({ ok: true });
}
