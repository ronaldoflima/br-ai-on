import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";

const HISTORY_DIR = ".config-history";
const MAX_VERSIONS = 10;

export interface ConfigVersion {
  timestamp: string;
  filename: string;
  displayLabel: string;
}

function historyDir(agentDir: string): string {
  return join(agentDir, HISTORY_DIR);
}

function timestampToLabel(ts: string): string {
  const [date, time] = ts.split("T");
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y} ${time.replace(/-/g, ":")}`;
}

function currentTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
}

export function listConfigHistory(agentDir: string): ConfigVersion[] {
  const dir = historyDir(agentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.yaml$/.test(f))
    .sort()
    .reverse()
    .map((filename) => {
      const timestamp = filename.replace(".yaml", "");
      return { timestamp, filename, displayLabel: timestampToLabel(timestamp) };
    });
}

export function saveConfigToHistory(
  agentDir: string,
  configContent: string,
): void {
  try {
    const dir = historyDir(agentDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filename = `${currentTimestamp()}.yaml`;
    writeFileSync(join(dir, filename), configContent, "utf-8");

    const versions = readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();
    while (versions.length > MAX_VERSIONS) {
      try {
        unlinkSync(join(dir, versions.shift()!));
      } catch {
        // ignore ENOENT from concurrent deletion
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error("Failed to save config to history: " + msg);
  }
}

export function getConfigHistoryVersion(
  agentDir: string,
  timestamp: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(timestamp)) return null;
  const filePath = join(historyDir(agentDir), `${timestamp}.yaml`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

export function restoreConfigVersion(
  agentDir: string,
  timestamp: string,
  currentConfigContent: string,
  targetConfigPath: string,
): boolean {
  try {
    const content = getConfigHistoryVersion(agentDir, timestamp);
    if (!content) return false;
    saveConfigToHistory(agentDir, currentConfigContent);
    const tmpPath = join(dirname(targetConfigPath), `.tmp-${randomBytes(4).toString("hex")}`);
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, targetConfigPath);
    return true;
  } catch {
    return false;
  }
}
