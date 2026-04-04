"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./Sidebar.module.css";
import { IconDashboard, IconLogs, IconHandoffs, IconAgents, IconMemories, IconTerminal, IconWizard, IconIntegrations, IconMenu, IconClose, IconGithub } from "./icons";

const NAV = [
  { href: "/", label: "Overview", icon: IconDashboard },
  { href: "/logs", label: "Logs", icon: IconLogs },
  { href: "/handoffs", label: "Handoffs", icon: IconHandoffs },
  { href: "/agents", label: "Agents", icon: IconAgents },
  { href: "/wizard", label: "Wizard", icon: IconWizard },
  { href: "/terminal", label: "Terminais", icon: IconTerminal },
];

const CLAUDE_CODE_NAV = [
  { href: "/memories", label: "Memórias", icon: IconMemories },
  { href: "/integrations", label: "Integrações", icon: IconIntegrations },
];

interface HealthData {
  agents_healthy: number;
  agents_total: number;
  pending_handoffs: number;
}

interface VersionData {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  repo: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [version, setVersion] = useState<VersionData | null>(null);
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  useEffect(() => {
    const fetchHealth = () => {
      fetch("/api/health")
        .then((r) => r.ok ? r.json() : null)
        .then(setHealth)
        .catch(() => {});
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.ok ? r.json() : null)
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <>
      <button className={styles.mobileToggle} onClick={() => setOpen(!open)} aria-label="Menu">
        {open ? <IconClose /> : <IconMenu />}
      </button>
      <nav className={`${styles.sidebar} ${open ? styles.open : ""}`}>
        <div className={styles.brand}>
          <img src="/braion-icon.png" alt="BR.AI.ON" width={40} height={40} className={styles.brandIcon} />
          BR.AI.ON
        </div>
        <ul className={styles.nav}>
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.navLink} ${isActive(item.href) ? styles.active : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className={styles.icon}><item.icon /></span>
                {item.label}
              </Link>
            </li>
          ))}
          <li className={styles.sectionLabel}>Claude Code</li>
          {CLAUDE_CODE_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.navLink} ${styles.subItem} ${isActive(item.href) ? styles.active : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className={styles.icon}><item.icon /></span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <button onClick={handleLogout} className={styles.logoutBtn}>Sair</button>
        {version && (
          <div className={styles.versionStrip}>
            <a href={version.repo} target="_blank" rel="noopener noreferrer" className={styles.versionLink}>
              <IconGithub />
              <span>v{version.current}</span>
            </a>
            {version.hasUpdate && (
              <a href={`${version.repo}/releases`} target="_blank" rel="noopener noreferrer" className={styles.updateBadge}>
                v{version.latest} disponível
              </a>
            )}
          </div>
        )}
        {health && (
          <div className={styles.healthStrip}>
            <div className={styles.healthRow}>
              <span className={styles.healthDot} style={{ background: health.agents_healthy === health.agents_total ? "var(--success)" : "var(--warning)" }} />
              <span>{health.agents_healthy}/{health.agents_total} agentes</span>
            </div>
            {health.pending_handoffs > 0 && (
              <div className={styles.healthRow}>
                <span className={styles.healthBadge}>{health.pending_handoffs}</span>
                <span>handoffs pendentes</span>
              </div>
            )}
          </div>
        )}
      </nav>
      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
    </>
  );
}
