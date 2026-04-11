import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse, stringify } from "yaml";

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const bVal = base[key];
    const oVal = override[key];
    if (
      bVal &&
      oVal &&
      typeof bVal === "object" &&
      typeof oVal === "object" &&
      !Array.isArray(bVal) &&
      !Array.isArray(oVal)
    ) {
      result[key] = deepMerge(
        bVal as Record<string, unknown>,
        oVal as Record<string, unknown>,
      );
    } else {
      result[key] = oVal;
    }
  }
  return result;
}

export function readMergedConfig(agentDir: string): {
  config: Record<string, unknown>;
  configRaw: string;
  hasOverride: boolean;
} {
  const basePath = join(agentDir, "config.yaml");
  const overridePath = join(agentDir, "config.override.yaml");

  let base: Record<string, unknown> = {};
  try {
    base = parse(readFileSync(basePath, "utf-8")) || {};
  } catch {
    // ignore
  }

  if (!existsSync(overridePath)) {
    return {
      config: base,
      configRaw: stringify(base),
      hasOverride: false,
    };
  }

  let override: Record<string, unknown> = {};
  try {
    override = parse(readFileSync(overridePath, "utf-8")) || {};
  } catch {
    // ignore
  }

  const merged = deepMerge(base, override);
  return {
    config: merged,
    configRaw: stringify(merged),
    hasOverride: true,
  };
}
