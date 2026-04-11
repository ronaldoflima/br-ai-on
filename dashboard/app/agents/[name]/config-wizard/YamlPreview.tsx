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
