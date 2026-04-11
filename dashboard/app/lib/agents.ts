import { existsSync } from "fs";
import { join } from "path";

export const PROJECT_ROOT = join(process.cwd(), "..");
export const AGENTS_DIR = join(PROJECT_ROOT, "agents");
export const DEFAULTS_DIR = join(AGENTS_DIR, "_defaults");

export function resolveAgentDir(
  name: string,
): { dir: string; isDefault: boolean } | null {
  if (!name || /[/\\]/.test(name) || name.includes("..")) {
    return null;
  }
  const userDir = join(AGENTS_DIR, name);
  if (existsSync(userDir) && existsSync(join(userDir, "config.yaml"))) {
    return { dir: userDir, isDefault: false };
  }
  const defaultDir = join(DEFAULTS_DIR, name);
  if (existsSync(defaultDir) && existsSync(join(defaultDir, "config.yaml"))) {
    return { dir: defaultDir, isDefault: true };
  }
  return null;
}
