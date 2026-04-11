import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

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
    .filter((f) => f.endsWith(".yaml"))
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
  const dir = historyDir(agentDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filename = `${currentTimestamp()}.yaml`;
  writeFileSync(join(dir, filename), configContent, "utf-8");

  const versions = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  while (versions.length > MAX_VERSIONS) {
    unlinkSync(join(dir, versions.shift()!));
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
  const content = getConfigHistoryVersion(agentDir, timestamp);
  if (!content) return false;
  saveConfigToHistory(agentDir, currentConfigContent);
  writeFileSync(targetConfigPath, content, "utf-8");
  return true;
}
