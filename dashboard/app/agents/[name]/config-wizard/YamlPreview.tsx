"use client";
import { useState } from "react";
import styles from "./config-wizard.module.css";

interface Props {
  yaml: string;
}

export function YamlPreview({ yaml }: Props) {
  const [copyLabel, setCopyLabel] = useState("Copiar YAML");

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopyLabel("Copiado!");
      setTimeout(() => setCopyLabel("Copiar YAML"), 2000);
    } catch {
      setCopyLabel("Erro ao copiar");
      setTimeout(() => setCopyLabel("Copiar YAML"), 2000);
    }
  }

  return (
    <div>
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>YAML Preview</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={copyToClipboard}
        >
          {copyLabel}
        </button>
      </div>
      <pre className={styles.previewCode}>{yaml}</pre>
    </div>
  );
}
