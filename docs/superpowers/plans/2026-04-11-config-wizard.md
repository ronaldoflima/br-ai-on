# Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar página `/agents/[name]/config-wizard` com formulário accordion guiado para editar configurações de agentes existentes, com preview YAML ao vivo e histórico de versões restaurável na aba Config.

**Architecture:** Server Component em `page.tsx` faz fetch direto do filesystem e passa dados para o Client Component `ConfigWizard`. Estado do formulário é React `useState`. YAML preview gerado client-side com lib `yaml`. Histórico armazenado em `.config-history/` no diretório do agente. `resolveAgentDir` é extraída para `lib/agents.ts` para ser compartilhada entre rotas.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS Modules, `yaml` v2.8.3 (já instalada)

---

## File Map

| File | Status | Responsabilidade |
|---|---|---|
| `dashboard/app/lib/agents.ts` | Novo | `resolveAgentDir` compartilhada + constantes de path |
| `dashboard/app/lib/config-history.ts` | Novo | Salvar, listar e restaurar versões de config |
| `dashboard/app/api/agents/[name]/route.ts` | Modificado | Importar `resolveAgentDir` do lib; PUT adiciona versioning |
| `dashboard/app/api/agents/[name]/config-history/route.ts` | Novo | GET: lista versões históricas |
| `dashboard/app/api/agents/[name]/config-history/restore/route.ts` | Novo | POST: restaura versão histórica |
| `dashboard/app/agents/[name]/config-wizard/types.ts` | Novo | Tipos TypeScript compartilhados do wizard |
| `dashboard/app/agents/[name]/config-wizard/config-wizard.module.css` | Novo | Layout split-pane (desktop) e abas (mobile) |
| `dashboard/app/agents/[name]/config-wizard/AccordionSection.tsx` | Novo | Componente accordion reutilizável |
| `dashboard/app/agents/[name]/config-wizard/sections.tsx` | Novo | Todas as seções: Identidade, Modelo, Runtime, Capabilities, Schedule, Budget, Integrações, Colaboradores |
| `dashboard/app/agents/[name]/config-wizard/YamlPreview.tsx` | Novo | Painel de preview YAML com botão copiar |
| `dashboard/app/agents/[name]/config-wizard/ConfigWizard.tsx` | Novo | Orquestrador: estado, split-pane, save, conversão form↔YAML |
| `dashboard/app/agents/[name]/config-wizard/page.tsx` | Novo | Server Component: lê filesystem, renderiza ConfigWizard |
| `dashboard/app/agents/[name]/page.tsx` | Modificado | Botão "Wizard" + seletor de versões históricas na aba Config |

---

### Task 1: Extrair `resolveAgentDir` para lib compartilhada

**Files:**
- Create: `dashboard/app/lib/agents.ts`
- Modify: `dashboard/app/api/agents/[name]/route.ts` (remover função local, importar do lib)

- [ ] **Step 1: Criar `lib/agents.ts`**

```typescript
// dashboard/app/lib/agents.ts
import { existsSync } from "fs";
import { join } from "path";

export const PROJECT_ROOT = join(process.cwd(), "..");
export const AGENTS_DIR = join(PROJECT_ROOT, "agents");
export const DEFAULTS_DIR = join(AGENTS_DIR, "_defaults");

export function resolveAgentDir(
  name: string,
): { dir: string; isDefault: boolean } | null {
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
```

- [ ] **Step 2: Modificar `route.ts` para importar do lib**

No topo de `dashboard/app/api/agents/[name]/route.ts`, adicionar:
```typescript
import { resolveAgentDir } from "../../../lib/agents";
```

Remover as 3 linhas de constantes e a função local `resolveAgentDir` (linhas 9-19 do arquivo):
```typescript
// REMOVER estas linhas:
const PROJECT_ROOT = join(process.cwd(), "..");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const DEFAULTS_DIR = join(AGENTS_DIR, "_defaults");

function resolveAgentDir(name: string): { dir: string; isDefault: boolean } | null {
  const userDir = join(AGENTS_DIR, name);
  if (existsSync(userDir) && existsSync(join(userDir, "config.yaml"))) return { dir: userDir, isDefault: false };
  const defaultDir = join(DEFAULTS_DIR, name);
  if (existsSync(defaultDir) && existsSync(join(defaultDir, "config.yaml"))) return { dir: defaultDir, isDefault: true };
  return null;
}
```

- [ ] **Step 3: Verificar compilação**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 4: Testar que o dashboard ainda funciona**

```bash
curl -s http://localhost:3040/api/agents/braion | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','ERRO'))"
```

Esperado: `braion` (ou o nome de um agente existente).

- [ ] **Step 5: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/lib/agents.ts dashboard/app/api/agents/\[name\]/route.ts
git commit -m "refactor: extrai resolveAgentDir para lib/agents.ts"
```

---

### Task 2: Lib de histórico de configuração

**Files:**
- Create: `dashboard/app/lib/config-history.ts`

- [ ] **Step 1: Criar `config-history.ts`**

```typescript
// dashboard/app/lib/config-history.ts
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
  timestamp: string;    // "2026-04-11T14-30-00"
  filename: string;     // "2026-04-11T14-30-00.yaml"
  displayLabel: string; // "11/04/2026 14:30:00"
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
  // Sanitiza timestamp para prevenir path traversal
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
```

- [ ] **Step 2: Verificar compilação**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1 | grep "config-history"
```

Esperado: sem output.

- [ ] **Step 3: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/lib/config-history.ts
git commit -m "feat(config-wizard): lib server-side de histórico de config"
```

---

### Task 3: APIs de histórico (GET + POST restore)

**Files:**
- Create: `dashboard/app/api/agents/[name]/config-history/route.ts`
- Create: `dashboard/app/api/agents/[name]/config-history/restore/route.ts`

- [ ] **Step 1: Criar rota GET `/api/agents/[name]/config-history`**

```typescript
// dashboard/app/api/agents/[name]/config-history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listConfigHistory, getConfigHistoryVersion } from "../../../../lib/config-history";
import { resolveAgentDir } from "../../../../lib/agents";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);
  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const timestamp = searchParams.get("timestamp");

  if (timestamp) {
    const content = getConfigHistoryVersion(resolved.dir, timestamp);
    if (!content) {
      return NextResponse.json({ error: "versão não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ content });
  }

  const versions = listConfigHistory(resolved.dir);
  return NextResponse.json({ versions });
}
```

- [ ] **Step 2: Criar rota POST `/api/agents/[name]/config-history/restore`**

```typescript
// dashboard/app/api/agents/[name]/config-history/restore/route.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { restoreConfigVersion } from "../../../../../lib/config-history";
import { resolveAgentDir } from "../../../../../lib/agents";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resolved = resolveAgentDir(name);
  if (!resolved) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const body = await request.json();
  const { timestamp } = body;
  if (!timestamp || typeof timestamp !== "string") {
    return NextResponse.json({ error: "timestamp required" }, { status: 400 });
  }

  const { dir: agentDir, isDefault } = resolved;
  const configFile = isDefault ? "config.override.yaml" : "config.yaml";
  const configPath = join(agentDir, configFile);

  if (!existsSync(configPath)) {
    return NextResponse.json({ error: "config file not found" }, { status: 404 });
  }

  const currentContent = readFileSync(configPath, "utf-8");
  const ok = restoreConfigVersion(agentDir, timestamp, currentContent, configPath);

  if (!ok) {
    return NextResponse.json({ error: "versão não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Testar as rotas**

Reinicie o dev server se necessário (`npm run dev` na pasta `dashboard`). Então:

```bash
curl -s http://localhost:3040/api/agents/braion/config-history | python3 -c "import sys,json; print(json.load(sys.stdin))"
```

Esperado: `{'versions': []}` (histórico vazio até salvar alguma vez).

- [ ] **Step 4: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/api/agents/\[name\]/config-history/
git commit -m "feat(config-wizard): rotas de histórico (GET list/content + POST restore)"
```

---

### Task 4: Versioning automático no PUT existente

**Files:**
- Modify: `dashboard/app/api/agents/[name]/route.ts` (bloco PUT, linhas ~140-155)

- [ ] **Step 1: Adicionar import de `saveConfigToHistory`**

No topo de `dashboard/app/api/agents/[name]/route.ts`, adicionar:
```typescript
import { saveConfigToHistory } from "../../../lib/config-history";
```

- [ ] **Step 2: Modificar o bloco `if (body.config !== undefined)` no PUT handler**

Localizar este bloco:
```typescript
if (body.config !== undefined) {
  const result = validateAgentConfig(body.config);
  if (!result.valid) {
    return NextResponse.json({ error: "Config inválida", errors: result.errors }, { status: 422 });
  }
  const targetFile = isDefault ? "config.override.yaml" : "config.yaml";
  writeFileSync(join(agentDir, targetFile), body.config);
}
```

Substituir por:
```typescript
if (body.config !== undefined) {
  const result = validateAgentConfig(body.config);
  if (!result.valid) {
    return NextResponse.json({ error: "Config inválida", errors: result.errors }, { status: 422 });
  }
  const targetFile = isDefault ? "config.override.yaml" : "config.yaml";
  const targetPath = join(agentDir, targetFile);
  if (existsSync(targetPath)) {
    saveConfigToHistory(agentDir, readFileSync(targetPath, "utf-8"));
  }
  writeFileSync(targetPath, body.config);
}
```

- [ ] **Step 3: Verificar compilação**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1 | head -10
```

Esperado: sem erros.

- [ ] **Step 4: Testar versioning end-to-end**

1. Abra o Config tab de qualquer agente e salve a config atual (sem mudanças)
2. Verifique que o histórico foi criado:

```bash
ls /home/mcpgw/br-ai-on/agents/braion/.config-history/ 2>/dev/null || echo "diretório não existe ainda"
```

Após salvar, deve aparecer um arquivo `.yaml` com timestamp.

- [ ] **Step 5: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/api/agents/\[name\]/route.ts
git commit -m "feat(config-wizard): versioning automático ao salvar config via PUT"
```

---

### Task 5: Tipos TypeScript e CSS do wizard

**Files:**
- Create: `dashboard/app/agents/[name]/config-wizard/types.ts`
- Create: `dashboard/app/agents/[name]/config-wizard/config-wizard.module.css`

- [ ] **Step 1: Criar `types.ts`**

```typescript
// dashboard/app/agents/[name]/config-wizard/types.ts

export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "plan"
  | "dontAsk";

export type ScheduleMode = "alive" | "handoff-only" | "disabled";

export type ModelId =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "claude-haiku-4-5-20251001";

export interface WizardIntegration {
  enabled: boolean;
  [key: string]: unknown;
}

export interface WizardCollaborator {
  name: string;
  [key: string]: unknown;
}

export interface WizardFormState {
  name: string;
  display_name: string;
  domain: string[];
  layer: string;
  version: string;
  model: ModelId;
  fallback_model: ModelId;
  permission_mode: PermissionMode | "";
  working_directory: string;
  command: string;
  capabilities: string[];
  schedule_mode: ScheduleMode;
  schedule_interval: string;
  schedule_priority: number;
  schedule_run_alone: boolean;
  max_tokens_per_session: number;
  max_sessions_per_day: number;
  integrations: Record<string, WizardIntegration>;
  collaborators: WizardCollaborator[];
}

export interface FieldError {
  field: string;
  message: string;
}

export const VALID_MODELS: ModelId[] = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
];

export const VALID_PERMISSION_MODES: PermissionMode[] = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "plan",
  "dontAsk",
];

export const VALID_LAYERS = [
  "infrastructure",
  "business",
  "service",
  "auxiliary",
];

export const VALID_SCHEDULE_MODES: ScheduleMode[] = [
  "alive",
  "handoff-only",
  "disabled",
];
```

- [ ] **Step 2: Criar `config-wizard.module.css`**

```css
/* dashboard/app/agents/[name]/config-wizard/config-wizard.module.css */

.container {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  padding: 16px 0 32px;
}

.formPanel {
  flex: 1;
  min-width: 0;
}

.previewPanel {
  width: 360px;
  flex-shrink: 0;
  position: sticky;
  top: 24px;
}

/* Abas mobile */
.mobileTabs {
  display: none;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

.mobileTab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: -1px;
}

.mobileTabActive {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 500;
}

@media (max-width: 768px) {
  .container {
    display: block;
  }

  .previewPanel {
    width: 100%;
    position: static;
    margin-top: 16px;
  }

  .mobileTabs {
    display: flex;
  }

  .formPanelHidden,
  .previewPanelHidden {
    display: none;
  }
}

/* Accordion */
.accordionItem {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}

.accordionHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: none;
  width: 100%;
  text-align: left;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text);
}

.accordionHeader:hover {
  background: var(--border);
}

.accordionHeaderError {
  border-left: 3px solid var(--error);
}

.accordionChevron {
  font-size: 10px;
  transition: transform 0.15s;
  display: inline-block;
}

.accordionChevronOpen {
  transform: rotate(180deg);
}

.accordionBody {
  padding: 16px;
  border-top: 1px solid var(--border);
}

/* Legenda */
.legend {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* Tag input para domain */
.tagInput {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  min-height: 38px;
  cursor: text;
  background: var(--bg);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}

.tagRemove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0 0 0 2px;
  font-size: 14px;
  line-height: 1;
}

.tagInput input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text);
  min-width: 80px;
  flex: 1;
}

/* Lista editável */
.listItem {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

/* Integrações */
.integrationRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.integrationName {
  min-width: 100px;
  font-size: 14px;
  font-weight: 500;
}

.integrationFields {
  margin-top: 8px;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.integrationFieldRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.integrationFieldRow label {
  min-width: 110px;
  color: var(--text-secondary);
}

/* Preview YAML */
.previewHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.previewTitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.previewCode {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  font-family: "Geist Mono", "Fira Code", monospace;
  font-size: 12px;
  white-space: pre;
  overflow: auto;
  max-height: 65vh;
  color: var(--text);
  line-height: 1.5;
}

/* Actions */
.actions {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  justify-content: flex-end;
  align-items: center;
}

.saveStatus {
  font-size: 13px;
  color: var(--success);
}

.saveStatusError {
  color: var(--error);
}

.fieldError {
  font-size: 11px;
  color: var(--error);
  margin-top: 2px;
  display: block;
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/config-wizard/types.ts
git add dashboard/app/agents/\[name\]/config-wizard/config-wizard.module.css
git commit -m "feat(config-wizard): tipos TypeScript e estilos CSS"
```

---

### Task 6: AccordionSection component

**Files:**
- Create: `dashboard/app/agents/[name]/config-wizard/AccordionSection.tsx`

- [ ] **Step 1: Criar componente**

```tsx
// dashboard/app/agents/[name]/config-wizard/AccordionSection.tsx
"use client";
import { useState } from "react";
import styles from "./config-wizard.module.css";

interface Props {
  title: string;
  hasError?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function AccordionSection({
  title,
  hasError,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.accordionItem}>
      <button
        type="button"
        className={`${styles.accordionHeader} ${hasError ? styles.accordionHeaderError : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span
          className={`${styles.accordionChevron} ${open ? styles.accordionChevronOpen : ""}`}
        >
          ▼
        </span>
      </button>
      {open && <div className={styles.accordionBody}>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/config-wizard/AccordionSection.tsx
git commit -m "feat(config-wizard): componente AccordionSection"
```

---

### Task 7: Seções do accordion

**Files:**
- Create: `dashboard/app/agents/[name]/config-wizard/sections.tsx`

- [ ] **Step 1: Criar `sections.tsx` com Identidade, Modelo, Runtime, Capabilities, Schedule e Budget**

```tsx
// dashboard/app/agents/[name]/config-wizard/sections.tsx
"use client";
import { useState, KeyboardEvent } from "react";
import { AccordionSection } from "./AccordionSection";
import {
  WizardFormState,
  VALID_MODELS,
  VALID_PERMISSION_MODES,
  VALID_LAYERS,
  VALID_SCHEDULE_MODES,
  FieldError,
  WizardIntegration,
  WizardCollaborator,
} from "./types";
import styles from "./config-wizard.module.css";

type Update = (patch: Partial<WizardFormState>) => void;

interface SectionProps {
  form: WizardFormState;
  update: Update;
  errors: FieldError[];
}

function fieldError(errors: FieldError[], field: string): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

// ─── Identidade ───────────────────────────────────────────────────────────────

export function IdentidadeSection({ form, update, errors }: SectionProps) {
  const [tagInput, setTagInput] = useState("");
  const hasError = ["display_name", "domain", "version"].some((f) =>
    fieldError(errors, f),
  );

  function addDomain(val: string) {
    const v = val.trim();
    if (v && !form.domain.includes(v)) {
      update({ domain: [...form.domain, v] });
    }
    setTagInput("");
  }

  function removeDomain(val: string) {
    update({ domain: form.domain.filter((d) => d !== val) });
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDomain(tagInput);
    }
    if (e.key === "Backspace" && tagInput === "" && form.domain.length > 0) {
      removeDomain(form.domain[form.domain.length - 1]);
    }
  }

  return (
    <AccordionSection title="Identidade" hasError={hasError} defaultOpen>
      <div className={styles.legend}>
        Informações básicas do agente. <strong>name</strong> é o identificador
        imutável (slug) — não editável aqui. <strong>domain</strong> define as
        áreas de conhecimento: use vírgulas ou Enter para adicionar tags.{" "}
        <strong>layer</strong> indica o papel arquitetural (infrastructure,
        business, service, auxiliary). <strong>version</strong> segue semver
        (X.Y.Z).
      </div>

      <div className="form-group">
        <label className="form-label">name</label>
        <input
          className="input"
          value={form.name}
          disabled
          readOnly
          style={{ opacity: 0.6 }}
        />
      </div>

      <div className="form-group">
        <label className="form-label">display_name</label>
        <input
          className="input"
          value={form.display_name}
          onChange={(e) => update({ display_name: e.target.value })}
          placeholder="Nome legível do agente"
        />
        {fieldError(errors, "display_name") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "display_name")}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">domain</label>
        <div
          className={styles.tagInput}
          onClick={() => document.getElementById("domain-input")?.focus()}
        >
          {form.domain.map((d) => (
            <span key={d} className={styles.tag}>
              {d}
              <button
                type="button"
                className={styles.tagRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  removeDomain(d);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="domain-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => {
              if (tagInput.trim()) addDomain(tagInput);
            }}
            placeholder={
              form.domain.length === 0 ? "orquestracao, coordenacao..." : ""
            }
          />
        </div>
        {fieldError(errors, "domain") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "domain")}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">layer</label>
        <select
          className="select"
          value={form.layer}
          onChange={(e) => update({ layer: e.target.value })}
        >
          <option value="">— opcional —</option>
          {VALID_LAYERS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">version</label>
        <input
          className="input"
          value={form.version}
          onChange={(e) => update({ version: e.target.value })}
          placeholder="1.0.0"
        />
        {fieldError(errors, "version") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "version")}
          </span>
        )}
      </div>
    </AccordionSection>
  );
}

// ─── Modelo ───────────────────────────────────────────────────────────────────

export function ModeloSection({ form, update, errors }: SectionProps) {
  const hasError = ["model", "fallback_model"].some((f) =>
    fieldError(errors, f),
  );

  return (
    <AccordionSection title="Modelo" hasError={hasError}>
      <div className={styles.legend}>
        <strong>model</strong> é o modelo principal usado nas sessões.{" "}
        <strong>fallback_model</strong> é usado quando o principal não está
        disponível. Prefira modelos mais capazes como principal (opus/sonnet) e
        mais rápidos como fallback (haiku).
      </div>

      <div className="form-group">
        <label className="form-label">model</label>
        <select
          className="select"
          value={form.model}
          onChange={(e) =>
            update({ model: e.target.value as typeof form.model })
          }
        >
          {VALID_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">fallback_model</label>
        <select
          className="select"
          value={form.fallback_model}
          onChange={(e) =>
            update({ fallback_model: e.target.value as typeof form.fallback_model })
          }
        >
          {VALID_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </AccordionSection>
  );
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export function RuntimeSection({ form, update, errors }: SectionProps) {
  const hasError = Boolean(
    fieldError(errors, "runtime.claude.permission_mode"),
  );

  return (
    <AccordionSection title="Runtime" hasError={hasError}>
      <div className={styles.legend}>
        <strong>permission_mode</strong>: controla autonomia do agente.{" "}
        <em>acceptEdits</em> pede confirmação para edições de arquivo;{" "}
        <em>auto</em> executa tudo automaticamente; <em>bypassPermissions</em>{" "}
        ignora todas as permissões (use com cuidado); <em>plan</em> só planeja
        sem executar; <em>dontAsk</em> similar ao auto. <strong>working_directory</strong>{" "}
        e <strong>command</strong> são opcionais — definem onde e como iniciar o agente.
      </div>

      <div className="form-group">
        <label className="form-label">permission_mode</label>
        <select
          className="select"
          value={form.permission_mode}
          onChange={(e) =>
            update({
              permission_mode: e.target.value as typeof form.permission_mode,
            })
          }
        >
          <option value="">— não definido —</option>
          {VALID_PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {fieldError(errors, "runtime.claude.permission_mode") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "runtime.claude.permission_mode")}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">working_directory</label>
        <input
          className="input"
          value={form.working_directory}
          onChange={(e) => update({ working_directory: e.target.value })}
          placeholder="/caminho/absoluto/opcional"
        />
      </div>

      <div className="form-group">
        <label className="form-label">command</label>
        <input
          className="input"
          value={form.command}
          onChange={(e) => update({ command: e.target.value })}
          placeholder="Comando opcional de inicialização"
        />
      </div>
    </AccordionSection>
  );
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

export function CapabilitiesSection({ form, update }: SectionProps) {
  const [newCap, setNewCap] = useState("");

  function addCap() {
    const v = newCap.trim();
    if (v) {
      update({ capabilities: [...form.capabilities, v] });
      setNewCap("");
    }
  }

  function removeCap(i: number) {
    update({ capabilities: form.capabilities.filter((_, idx) => idx !== i) });
  }

  return (
    <AccordionSection title="Capabilities">
      <div className={styles.legend}>
        Lista de capacidades do agente — frases curtas que descrevem o que ele
        pode fazer. Usadas para roteamento dinâmico e para contextualizar outros
        agentes que precisam delegar tarefas.
      </div>

      {form.capabilities.map((cap, i) => (
        <div key={i} className={styles.listItem}>
          <input
            className="input"
            value={cap}
            onChange={(e) => {
              const caps = [...form.capabilities];
              caps[i] = e.target.value;
              update({ capabilities: caps });
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => removeCap(i)}
          >
            ×
          </button>
        </div>
      ))}

      <div className={styles.listItem}>
        <input
          className="input"
          value={newCap}
          onChange={(e) => setNewCap(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCap();
            }
          }}
          placeholder="Nova capability (Enter para adicionar)"
        />
        <button type="button" className="btn btn-primary" onClick={addCap}>
          +
        </button>
      </div>
    </AccordionSection>
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export function ScheduleSection({ form, update, errors }: SectionProps) {
  const hasError = ["schedule.mode", "schedule.interval"].some((f) =>
    fieldError(errors, f),
  );

  return (
    <AccordionSection title="Schedule" hasError={hasError}>
      <div className={styles.legend}>
        <strong>mode</strong>: <em>alive</em> = roda automaticamente em
        intervalos; <em>handoff-only</em> = só executa quando recebe um handoff;{" "}
        <em>disabled</em> = inativo. <strong>interval</strong>: obrigatório se
        mode=alive. Exemplos: <code>15m</code>, <code>1h</code>,{" "}
        <code>7d</code>. <strong>priority</strong>: prioridade de execução (0 =
        normal, maior = mais prioritário). <strong>run_alone</strong>: se true,
        não executa em paralelo com outros agentes.
      </div>

      <div className="form-group">
        <label className="form-label">mode</label>
        <select
          className="select"
          value={form.schedule_mode}
          onChange={(e) =>
            update({ schedule_mode: e.target.value as typeof form.schedule_mode })
          }
        >
          {VALID_SCHEDULE_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {form.schedule_mode === "alive" && (
        <div className="form-group">
          <label className="form-label">interval</label>
          <input
            className="input"
            value={form.schedule_interval}
            onChange={(e) => update({ schedule_interval: e.target.value })}
            placeholder="15m"
          />
          {fieldError(errors, "schedule.interval") && (
            <span className={styles.fieldError}>
              {fieldError(errors, "schedule.interval")}
            </span>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">priority</label>
        <input
          className="input"
          type="number"
          min={0}
          value={form.schedule_priority}
          onChange={(e) =>
            update({ schedule_priority: Number(e.target.value) })
          }
        />
      </div>

      <div className="form-group">
        <label
          className="form-label"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            type="checkbox"
            checked={form.schedule_run_alone}
            onChange={(e) => update({ schedule_run_alone: e.target.checked })}
          />
          run_alone
        </label>
      </div>
    </AccordionSection>
  );
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export function BudgetSection({ form, update, errors }: SectionProps) {
  const hasError = [
    "budget.max_tokens_per_session",
    "budget.max_sessions_per_day",
  ].some((f) => fieldError(errors, f));

  return (
    <AccordionSection title="Budget" hasError={hasError}>
      <div className={styles.legend}>
        Limites de custo por agente.{" "}
        <strong>max_tokens_per_session</strong>: máximo de tokens por sessão
        (mín. 1000) — afeta diretamente o custo e quanto o agente consegue
        processar por vez. <strong>max_sessions_per_day</strong>: quantas sessões
        o agente pode iniciar por dia (mín. 1).
      </div>

      <div className="form-group">
        <label className="form-label">max_tokens_per_session</label>
        <input
          className="input"
          type="number"
          min={1000}
          step={1000}
          value={form.max_tokens_per_session}
          onChange={(e) =>
            update({ max_tokens_per_session: Number(e.target.value) })
          }
        />
        {fieldError(errors, "budget.max_tokens_per_session") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "budget.max_tokens_per_session")}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">max_sessions_per_day</label>
        <input
          className="input"
          type="number"
          min={1}
          value={form.max_sessions_per_day}
          onChange={(e) =>
            update({ max_sessions_per_day: Number(e.target.value) })
          }
        />
        {fieldError(errors, "budget.max_sessions_per_day") && (
          <span className={styles.fieldError}>
            {fieldError(errors, "budget.max_sessions_per_day")}
          </span>
        )}
      </div>
    </AccordionSection>
  );
}

// ─── Integrações ──────────────────────────────────────────────────────────────

export function IntegracoesSection({ form, update }: SectionProps) {
  const integrationKeys = Object.keys(form.integrations);

  function toggleEnabled(key: string, enabled: boolean) {
    update({
      integrations: {
        ...form.integrations,
        [key]: { ...form.integrations[key], enabled },
      },
    });
  }

  function updateField(key: string, field: string, value: string) {
    update({
      integrations: {
        ...form.integrations,
        [key]: { ...form.integrations[key], [field]: value },
      },
    });
  }

  if (integrationKeys.length === 0) {
    return (
      <AccordionSection title="Integrações">
        <div className={styles.legend}>
          Nenhuma integração configurada neste agente. Para adicionar, edite o{" "}
          <code>config.yaml</code> diretamente com a chave{" "}
          <code>integrations</code> e reabra o wizard.
        </div>
      </AccordionSection>
    );
  }

  return (
    <AccordionSection title="Integrações">
      <div className={styles.legend}>
        Ativa ou desativa MCPs para este agente.{" "}
        <strong>telegram</strong>: notificações e comandos via bot.{" "}
        <strong>notion</strong>: leitura e escrita de páginas.{" "}
        <strong>obsidian</strong>: acesso ao vault pessoal.{" "}
        <strong>superset</strong>: queries em dashboards de dados. Campos
        adicionais (ex: <code>database_id</code>) aparecem ao ativar a integração.
      </div>

      {integrationKeys.map((key) => {
        const integration = form.integrations[key];
        const extraFields = Object.entries(integration).filter(
          ([k]) => k !== "enabled",
        );

        return (
          <div key={key}>
            <div className={styles.integrationRow}>
              <input
                type="checkbox"
                id={`integration-${key}`}
                checked={integration.enabled}
                onChange={(e) => toggleEnabled(key, e.target.checked)}
              />
              <label
                htmlFor={`integration-${key}`}
                className={styles.integrationName}
              >
                {key}
              </label>
            </div>

            {integration.enabled && extraFields.length > 0 && (
              <div className={styles.integrationFields}>
                {extraFields.map(([field, value]) => (
                  <div key={field} className={styles.integrationFieldRow}>
                    <label>{field}</label>
                    <input
                      className="input"
                      value={String(value ?? "")}
                      onChange={(e) => updateField(key, field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </AccordionSection>
  );
}

// ─── Colaboradores ────────────────────────────────────────────────────────────

export function ColaboradoresSection({ form, update }: SectionProps) {
  function addCollaborator() {
    update({
      collaborators: [...form.collaborators, { name: "" }],
    });
  }

  function removeCollaborator(i: number) {
    update({
      collaborators: form.collaborators.filter((_, idx) => idx !== i),
    });
  }

  function updateCollaboratorName(i: number, value: string) {
    const cols = [...form.collaborators] as WizardCollaborator[];
    cols[i] = { ...cols[i], name: value };
    update({ collaborators: cols });
  }

  return (
    <AccordionSection title="Colaboradores">
      <div className={styles.legend}>
        Outros agentes com quem este agente colabora diretamente. O campo{" "}
        <strong>name</strong> é o slug do agente colaborador (ex:{" "}
        <code>inbox-router</code>). Usado pelo sistema para definir rotas de
        handoff e contexto compartilhado.
      </div>

      {form.collaborators.map((col, i) => (
        <div key={i} className={styles.listItem}>
          <input
            className="input"
            value={col.name}
            onChange={(e) => updateCollaboratorName(i, e.target.value)}
            placeholder="slug-do-agente"
          />
          <button
            type="button"
            className="btn"
            onClick={() => removeCollaborator(i)}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn"
        onClick={addCollaborator}
        style={{ marginTop: 8 }}
      >
        + Adicionar colaborador
      </button>
    </AccordionSection>
  );
}
```

- [ ] **Step 2: Verificar compilação**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1 | grep "sections"
```

Esperado: sem output.

- [ ] **Step 3: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/config-wizard/sections.tsx
git commit -m "feat(config-wizard): todas as seções do accordion"
```

---

### Task 8: YamlPreview e ConfigWizard (orquestrador)

**Files:**
- Create: `dashboard/app/agents/[name]/config-wizard/YamlPreview.tsx`
- Create: `dashboard/app/agents/[name]/config-wizard/ConfigWizard.tsx`

- [ ] **Step 1: Criar `YamlPreview.tsx`**

```tsx
// dashboard/app/agents/[name]/config-wizard/YamlPreview.tsx
"use client";
import styles from "./config-wizard.module.css";

interface Props {
  yaml: string;
}

export function YamlPreview({ yaml }: Props) {
  async function copyToClipboard() {
    await navigator.clipboard.writeText(yaml);
  }

  return (
    <div>
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>YAML Preview</span>
        <button
          type="button"
          className="btn"
          onClick={copyToClipboard}
          style={{ fontSize: 12 }}
        >
          Copiar
        </button>
      </div>
      <pre className={styles.previewCode}>{yaml}</pre>
    </div>
  );
}
```

- [ ] **Step 2: Criar `ConfigWizard.tsx`**

```tsx
// dashboard/app/agents/[name]/config-wizard/ConfigWizard.tsx
"use client";
import { useState, useMemo } from "react";
import { stringify } from "yaml";
import { useRouter } from "next/navigation";
import {
  WizardFormState,
  WizardIntegration,
  WizardCollaborator,
  ModelId,
  PermissionMode,
  ScheduleMode,
  FieldError,
} from "./types";
import {
  IdentidadeSection,
  ModeloSection,
  RuntimeSection,
  CapabilitiesSection,
  ScheduleSection,
  BudgetSection,
  IntegracoesSection,
  ColaboradoresSection,
} from "./sections";
import { YamlPreview } from "./YamlPreview";
import styles from "./config-wizard.module.css";

function configToForm(raw: Record<string, unknown>): WizardFormState {
  const schedule = (raw.schedule ?? {}) as Record<string, unknown>;
  const budget = (raw.budget ?? {}) as Record<string, unknown>;
  const runtime = (raw.runtime ?? {}) as Record<string, Record<string, unknown>>;

  return {
    name: String(raw.name ?? ""),
    display_name: String(raw.display_name ?? ""),
    domain: Array.isArray(raw.domain)
      ? raw.domain.map(String)
      : raw.domain
      ? [String(raw.domain)]
      : [],
    layer: String(raw.layer ?? ""),
    version: String(raw.version ?? "1.0.0"),
    model: (raw.model as ModelId) ?? "claude-sonnet-4-6",
    fallback_model: (raw.fallback_model as ModelId) ?? "claude-haiku-4-5",
    permission_mode:
      (runtime.claude?.permission_mode as PermissionMode | "") ?? "",
    working_directory: String(raw.working_directory ?? ""),
    command: String(raw.command ?? ""),
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.map(String)
      : [],
    schedule_mode: (schedule.mode as ScheduleMode) ?? "handoff-only",
    schedule_interval: String(schedule.interval ?? ""),
    schedule_priority: Number(schedule.priority ?? 0),
    schedule_run_alone: Boolean(schedule.run_alone ?? false),
    max_tokens_per_session: Number(budget.max_tokens_per_session ?? 50000),
    max_sessions_per_day: Number(budget.max_sessions_per_day ?? 5),
    integrations:
      (raw.integrations as Record<string, WizardIntegration>) ?? {},
    collaborators: Array.isArray(raw.collaborators)
      ? (raw.collaborators as WizardCollaborator[])
      : [],
  };
}

function formToConfig(form: WizardFormState): Record<string, unknown> {
  const config: Record<string, unknown> = {
    name: form.name,
    display_name: form.display_name,
    domain: form.domain.length === 1 ? form.domain[0] : form.domain,
    version: form.version,
    model: form.model,
    fallback_model: form.fallback_model,
    schedule: {
      mode: form.schedule_mode,
      ...(form.schedule_mode === "alive"
        ? { interval: form.schedule_interval }
        : {}),
      ...(form.schedule_priority !== 0
        ? { priority: form.schedule_priority }
        : {}),
      ...(form.schedule_run_alone ? { run_alone: true } : {}),
    },
    budget: {
      max_tokens_per_session: form.max_tokens_per_session,
      max_sessions_per_day: form.max_sessions_per_day,
    },
  };

  if (form.layer) config.layer = form.layer;
  if (form.working_directory) config.working_directory = form.working_directory;
  if (form.command) config.command = form.command;
  if (form.capabilities.length > 0) config.capabilities = form.capabilities;
  if (form.permission_mode) {
    config.runtime = { claude: { permission_mode: form.permission_mode } };
  }
  if (Object.keys(form.integrations).length > 0) {
    config.integrations = form.integrations;
  }
  if (form.collaborators.length > 0) {
    config.collaborators = form.collaborators;
  }

  return config;
}

interface Props {
  name: string;
  initialConfig: Record<string, unknown>;
}

export function ConfigWizard({ name, initialConfig }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<WizardFormState>(() =>
    configToForm(initialConfig),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [mobileTab, setMobileTab] = useState<"form" | "yaml">("form");

  const yamlString = useMemo(() => stringify(formToConfig(form)), [form]);

  function update(patch: Partial<WizardFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors([]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch(`/api/agents/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: yamlString }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus("Salvo!");
        setTimeout(() => router.push(`/agents/${name}`), 800);
      } else {
        setErrors(data.errors ?? []);
        setSaveStatus("Erro ao salvar");
      }
    } catch {
      setSaveStatus("Erro de conexão");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(""), 3000);
    }
  }

  const sectionProps = { form, update, errors };

  return (
    <div>
      {/* Abas — visíveis apenas em mobile via CSS */}
      <div className={styles.mobileTabs}>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobileTab === "form" ? styles.mobileTabActive : ""}`}
          onClick={() => setMobileTab("form")}
        >
          Formulário
        </button>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobileTab === "yaml" ? styles.mobileTabActive : ""}`}
          onClick={() => setMobileTab("yaml")}
        >
          YAML
        </button>
      </div>

      <div className={styles.container}>
        {/* Painel do formulário */}
        <div
          className={`${styles.formPanel} ${mobileTab !== "form" ? styles.formPanelHidden : ""}`}
        >
          <IdentidadeSection {...sectionProps} />
          <ModeloSection {...sectionProps} />
          <RuntimeSection {...sectionProps} />
          <CapabilitiesSection {...sectionProps} />
          <ScheduleSection {...sectionProps} />
          <BudgetSection {...sectionProps} />
          <IntegracoesSection {...sectionProps} />
          <ColaboradoresSection {...sectionProps} />

          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={() => router.push(`/agents/${name}`)}
            >
              Cancelar
            </button>
            {saveStatus && (
              <span
                className={`${styles.saveStatus} ${
                  saveStatus.includes("Erro") ? styles.saveStatusError : ""
                }`}
              >
                {saveStatus}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || errors.length > 0}
            >
              {saving ? "Salvando..." : "Salvar nova versão"}
            </button>
          </div>
        </div>

        {/* Painel de preview YAML */}
        <div
          className={`${styles.previewPanel} ${mobileTab !== "yaml" ? styles.previewPanelHidden : ""}`}
        >
          <YamlPreview yaml={yamlString} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar compilação**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/config-wizard/YamlPreview.tsx
git add dashboard/app/agents/\[name\]/config-wizard/ConfigWizard.tsx
git commit -m "feat(config-wizard): ConfigWizard orquestrador e YamlPreview"
```

---

### Task 9: Server Component — página do wizard

**Files:**
- Create: `dashboard/app/agents/[name]/config-wizard/page.tsx`

- [ ] **Step 1: Criar `page.tsx`**

```tsx
// dashboard/app/agents/[name]/config-wizard/page.tsx
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import { parse } from "yaml";
import { resolveAgentDir } from "../../../../lib/agents";
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

  // Para agentes default: usa override se existir, senão usa o base
  const activePath = isDefault && existsSync(overridePath) ? overridePath : basePath;
  if (!existsSync(activePath)) notFound();

  const configRaw = readFileSync(activePath, "utf-8");
  let config: Record<string, unknown> = { name };
  try {
    config = (parse(configRaw) ?? { name }) as Record<string, unknown>;
  } catch {
    // YAML inválido — ainda abre o wizard com name preenchido
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
```

- [ ] **Step 2: Testar a página no browser**

Certifique-se que o dev server está rodando:
```bash
cd /home/mcpgw/br-ai-on/dashboard && npm run dev 2>&1 &
```

Acesse `http://localhost:3040/agents/braion/config-wizard` (substitua `braion` por um agente existente).

Verifique:
- Formulário carrega com valores pré-preenchidos do config atual
- YAML preview aparece à direita com o YAML gerado
- Seção Identidade abre por padrão (`defaultOpen`)
- Alterar um campo atualiza o YAML preview em tempo real

- [ ] **Step 3: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/config-wizard/page.tsx
git commit -m "feat(config-wizard): page.tsx Server Component"
```

---

### Task 10: Botão Wizard + seletor de versões na aba Config

**Files:**
- Modify: `dashboard/app/agents/[name]/page.tsx`

- [ ] **Step 1: Adicionar states de histórico**

Localizar o bloco de `useState` no componente e adicionar:
```typescript
const [configHistory, setConfigHistory] = useState<
  Array<{ timestamp: string; displayLabel: string }>
>([]);
const [selectedVersion, setSelectedVersion] = useState("");
```

- [ ] **Step 2: Adicionar função `fetchHistory`**

Após a função `validateConfig`, adicionar:
```typescript
const fetchHistory = async () => {
  try {
    const res = await fetch(`/api/agents/${name}/config-history`);
    const data = await res.json();
    setConfigHistory(data.versions ?? []);
  } catch {
    setConfigHistory([]);
  }
};
```

- [ ] **Step 3: Chamar `fetchHistory` ao abrir a aba Config**

Localizar o handler `onClick` das tabs. Na aba `"config"`, adicionar `fetchHistory()`:
```typescript
onClick={() => {
  setTab(t);
  if (t === "terminal") fetchTerminal();
  if (t === "config") fetchHistory();
}}
```

- [ ] **Step 4: Adicionar botão Wizard e seletor de versões no render da aba Config**

Localizar o bloco de render da aba config (onde estão os botões "Salvar Config", "Validar", etc.) e adicionar:

**Botão Wizard** (junto aos outros botões de ação):
```tsx
<a href={`/agents/${name}/config-wizard`} className="btn btn-primary">
  Wizard
</a>
```

**Seletor de versões** (acima do `<textarea>` da config):
```tsx
{configHistory.length > 0 && (
  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
    <select
      className="select"
      value={selectedVersion}
      onChange={(e) => setSelectedVersion(e.target.value)}
      style={{ fontSize: 13 }}
    >
      <option value="">Versão atual</option>
      {configHistory.map((v) => (
        <option key={v.timestamp} value={v.timestamp}>
          {v.displayLabel}
        </option>
      ))}
    </select>
    {selectedVersion && (
      <button
        className="btn"
        onClick={async () => {
          const label = configHistory.find(
            (v) => v.timestamp === selectedVersion,
          )?.displayLabel;
          if (!confirm(`Restaurar versão de ${label}?`)) return;
          const res = await fetch(
            `/api/agents/${name}/config-history/restore`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ timestamp: selectedVersion }),
            },
          );
          if (res.ok) {
            window.location.reload();
          }
        }}
      >
        Restaurar esta versão
      </button>
    )}
  </div>
)}
```

- [ ] **Step 5: Testar no browser**

1. Acesse `/agents/braion` → aba Config
2. Confirme que o botão "Wizard" aparece
3. Clique em "Wizard" → confirme que navega para o formulário
4. No wizard, mude algum campo e clique "Salvar nova versão"
5. Volte para aba Config → confirme que o dropdown de versões aparece com 1 entrada
6. Selecione a versão e clique "Restaurar esta versão" → confirme reload com config restaurada

- [ ] **Step 6: Verificar compilação final**

```bash
cd /home/mcpgw/br-ai-on/dashboard && npx tsc --noEmit 2>&1
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
cd /home/mcpgw/br-ai-on
git add dashboard/app/agents/\[name\]/page.tsx
git commit -m "feat(config-wizard): botão Wizard e seletor de versões históricas na aba Config"
```
