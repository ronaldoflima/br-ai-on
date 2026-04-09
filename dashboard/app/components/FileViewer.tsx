"use client";
import { useEffect, useState } from "react";
import styles from "./FileViewer.module.css";

interface Props {
  session: string;
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export function FileViewer({ session, filePath, fileName, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    setContent(null);

    const lastSlash = filePath.lastIndexOf("/");
    const dir = filePath.substring(0, lastSlash);
    const file = filePath.substring(lastSlash + 1);

    const params = new URLSearchParams({ session, path: dir, file });
    fetch(`/api/terminal/files?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setContent(data.content);
        }
      })
      .catch(() => setError("Erro de conexão"))
      .finally(() => setLoading(false));
  }, [session, filePath]);

  const handleDownload = () => {
    const lastSlash = filePath.lastIndexOf("/");
    const dir = filePath.substring(0, lastSlash);
    const file = filePath.substring(lastSlash + 1);
    const params = new URLSearchParams({ session, path: dir, file, download: "1" });
    const a = document.createElement("a");
    a.href = `/api/terminal/files?${params}`;
    a.download = file;
    a.click();
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <button className={styles.backBtn} onClick={onClose}>←</button>
        <span className={styles.fileName} title={filePath}>{fileName}</span>
        <div className={styles.actions}>
          <select
            className={styles.modeSelect}
            value={rawMode ? "raw" : "formatted"}
            onChange={(e) => setRawMode(e.target.value === "raw")}
          >
            <option value="formatted">Formatado</option>
            <option value="raw">Raw</option>
          </select>
          <button className="btn" onClick={handleDownload} title="Baixar arquivo">
            ↓ Download
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {loading && <div className={styles.msg}>Carregando...</div>}
        {error && <div className={`${styles.msg} ${styles.error}`}>{error}</div>}
        {content !== null && (
          <pre className={rawMode ? styles.rawPre : styles.formattedPre}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
