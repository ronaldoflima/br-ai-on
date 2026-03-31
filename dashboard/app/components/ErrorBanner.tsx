"use client";
import { useEffect, useState } from "react";

interface AgentError {
  name: string;
  displayName: string;
  state: string;
}

export function ErrorBanner() {
  const [errors, setErrors] = useState<AgentError[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => {
      fetch("/api/status")
        .then((r) => r.ok ? r.json() : [])
        .then((agents: AgentError[]) => {
          setErrors(agents.filter((a) => a.state === "error"));
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  if (dismissed || errors.length === 0) return null;

  return (
    <div className="error-banner">
      <span>
        {errors.map((a) => a.displayName || a.name).join(", ")} em estado de erro
      </span>
      <button className="error-banner-close" onClick={() => setDismissed(true)}>×</button>
    </div>
  );
}
