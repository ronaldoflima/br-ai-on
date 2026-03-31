"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Erro ao validar código");
        setCode("");
        inputRef.current?.focus();
      }
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <img src="/hawk-icon.png" alt="HawkAI" width={64} height={64} style={styles.icon} />
        <h1 style={styles.title}>HawkAI</h1>
        <p style={styles.subtitle}>Digite o código do autenticador</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            style={styles.input}
            disabled={loading}
            autoComplete="one-time-code"
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading || code.length !== 6} style={styles.button}>
            {loading ? "Verificando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary)",
  },
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "40px",
    width: "100%",
    maxWidth: "360px",
    textAlign: "center",
  },
  icon: {
    borderRadius: "12px",
    marginBottom: "12px",
  },
  title: {
    fontSize: "22px",
    fontWeight: 700,
    marginBottom: "6px",
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: "13px",
    color: "var(--text-secondary)",
    marginBottom: "28px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  input: {
    background: "var(--bg-input)",
    border: "1px solid var(--border-light)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    fontSize: "28px",
    letterSpacing: "12px",
    padding: "12px",
    textAlign: "center",
    width: "100%",
    fontFamily: "monospace",
    outline: "none",
  },
  error: {
    color: "var(--error)",
    fontSize: "13px",
  },
  button: {
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px",
    width: "100%",
    opacity: 1,
  },
};
