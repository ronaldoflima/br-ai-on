"use client";
import { useEffect, useState, useCallback } from "react";
import styles from "./FileExplorer.module.css";

interface FileItem {
  name: string;
  isDir: boolean;
  size: number;
  sizeFormatted: string;
  type: string;
}

interface Props {
  session: string;
  onFileSelect: (path: string, name: string) => void;
}

export function FileExplorer({ session, onFileSelect }: Props) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ session });
      if (path) params.set("path", path);
      const res = await fetch(`/api/terminal/files?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao carregar");
        return;
      }
      setCurrentPath(data.path);
      setItems(data.items);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    setCurrentPath(null);
    setItems([]);
    setHistory([]);
    loadDir();
  }, [session, loadDir]);

  const navigateTo = (dir: FileItem) => {
    if (!currentPath) return;
    const newPath = `${currentPath}/${dir.name}`;
    setHistory((h) => [...h, currentPath]);
    loadDir(newPath);
  };

  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    loadDir(prev);
  };

  const breadcrumbs = currentPath
    ? currentPath.split("/").filter(Boolean).map((part, i, arr) => ({
        label: part,
        path: "/" + arr.slice(0, i + 1).join("/"),
      }))
    : [];

  return (
    <div className={styles.explorer}>
      <div className={styles.breadcrumb}>
        <button className={styles.breadcrumbItem} onClick={() => { setHistory([]); loadDir(); }} title="Raiz da sessão">~</button>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            <span className={styles.breadcrumbSep}>/</span>
            <button
              className={styles.breadcrumbItem}
              onClick={() => {
                const newHistory = breadcrumbs.slice(0, i).map((c) => c.path);
                setHistory(newHistory);
                loadDir(crumb.path);
              }}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Carregando...</div>
      ) : (
        <div className={styles.fileList}>
          {history.length > 0 && (
            <button className={styles.fileItem} onClick={goBack}>
              <span className={styles.fileIcon}>←</span>
              <span className={styles.fileName}>..</span>
            </button>
          )}
          {items.map((item) => (
            <button
              key={item.name}
              className={styles.fileItem}
              onClick={() => {
                if (item.isDir) {
                  navigateTo(item);
                } else {
                  onFileSelect(`${currentPath}/${item.name}`, item.name);
                }
              }}
              title={item.name}
            >
              <span className={styles.fileIcon}>
                {item.isDir ? "📁" : getFileIcon(item.type)}
              </span>
              <span className={styles.fileName}>{item.name}</span>
              {!item.isDir && <span className={styles.fileSize}>{item.sizeFormatted}</span>}
            </button>
          ))}
          {items.length === 0 && !loading && (
            <div className={styles.empty}>Diretório vazio</div>
          )}
        </div>
      )}
    </div>
  );
}

function getFileIcon(type: string): string {
  const icons: Record<string, string> = {
    markdown: "📝", json: "📋", typescript: "📘", javascript: "📒",
    python: "🐍", shell: "⚡", log: "📄", yaml: "📋", csv: "📊",
    html: "🌐", css: "🎨", tsx: "📘", jsx: "📒",
  };
  return icons[type] || "📄";
}
