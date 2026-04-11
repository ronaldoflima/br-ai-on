import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import { parse } from "yaml";
import { resolveAgentDir } from "../../../lib/agents";
import { ConfigWizard } from "./ConfigWizard";

interface Props {
  params: Promise<{ name: string }>;
}

export default async function ConfigWizardPage({ params }: Props) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);
  if (!resolved) notFound();

  const { dir: agentDir, isDefault } = resolved;
  const overridePath = join(agentDir, "config.override.yaml");
  const basePath = join(agentDir, "config.yaml");

  const activePath = isDefault && existsSync(overridePath) ? overridePath : basePath;
  let configRaw: string;
  try {
    configRaw = readFileSync(activePath, "utf-8");
  } catch {
    notFound();
    return;
  }
  let config: Record<string, unknown> = { name };
  try {
    config = (parse(configRaw) ?? { name }) as Record<string, unknown>;
  } catch {
    // Invalid YAML — wizard opens with name pre-filled
  }

  const displayName = String(config.display_name ?? name);
  const editingFile = isDefault
    ? existsSync(overridePath)
      ? "config.override.yaml"
      : "config.yaml (base — criará override ao salvar)"
    : "config.yaml";

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Config Wizard — {displayName}</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
          Editando: <code>{editingFile}</code>
        </p>
      </div>
      <ConfigWizard name={name} initialConfig={config} />
    </div>
  );
}
