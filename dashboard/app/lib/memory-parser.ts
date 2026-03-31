import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { extractProjectName } from "./memory-scanner";


export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface Memory {
  id: string;
  fileName: string;
  projectSlug: string;
  projectName: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  lastModified: string;
}

export function generateId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

export function toSnakeCase(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function generateFileName(type: MemoryType, name: string): string {
  return `${type}_${toSnakeCase(name)}.md`;
}

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  try {
    return { data: yamlParse(match[1]) || {}, body: match[2] };
  } catch {
    return { data: {}, body: content };
  }
}

function serializeMemory(name: string, description: string, type: MemoryType, body: string): string {
  const fm = yamlStringify({ name, description, type }).trimEnd();
  return `---\n${fm}\n---\n\n${body}\n`;
}

export async function parseMemoryFile(filePath: string, projectSlug: string): Promise<Memory | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const { data, body } = parseFrontmatter(content);
    const stat = await fs.stat(filePath);
    return {
      id: generateId(filePath),
      fileName: path.basename(filePath),
      projectSlug,
      projectName: extractProjectName(projectSlug),
      name: data.name || path.basename(filePath, ".md"),
      description: data.description || "",
      type: (data.type as MemoryType) || "reference",
      body: body.trim(),
      lastModified: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function listMemories(memoryDir: string, projectSlug: string): Promise<Memory[]> {
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const memories: Memory[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "MEMORY.md" || !entry.name.endsWith(".md")) continue;
    const memory = await parseMemoryFile(path.join(memoryDir, entry.name), projectSlug);
    if (memory) memories.push(memory);
  }
  return memories;
}

export async function writeMemoryFile(
  filePath: string,
  name: string,
  description: string,
  type: MemoryType,
  body: string
): Promise<void> {
  await fs.writeFile(filePath, serializeMemory(name, description, type, body), "utf-8");
}

export async function createBackup(filePath: string): Promise<void> {
  const backupDir = path.join(path.dirname(filePath), ".backups");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(filePath, path.join(backupDir, `${path.basename(filePath)}.bak`));
}

export async function findMemoryById(
  memoryDir: string,
  projectSlug: string,
  id: string
): Promise<{ memory: Memory; filePath: string } | null> {
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "MEMORY.md" || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(memoryDir, entry.name);
    if (generateId(filePath) === id) {
      const memory = await parseMemoryFile(filePath, projectSlug);
      if (memory) return { memory, filePath };
    }
  }
  return null;
}
