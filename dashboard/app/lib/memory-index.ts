import fs from "fs/promises";
import path from "path";
import { parse as yamlParse } from "yaml";

export async function reconcileIndex(memoryDir: string): Promise<void> {
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const lines: string[] = ["# Memory Index", ""];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "MEMORY.md" || !entry.name.endsWith(".md")) continue;
    try {
      const content = await fs.readFile(path.join(memoryDir, entry.name), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const data = match ? (yamlParse(match[1]) || {}) : {};
      lines.push(`- [${entry.name}](${entry.name}) — ${data.description || ""}`);
    } catch {
      lines.push(`- [${entry.name}](${entry.name})`);
    }
  }
  lines.push("");
  await fs.writeFile(path.join(memoryDir, "MEMORY.md"), lines.join("\n"), "utf-8");
}
