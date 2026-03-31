"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./Sidebar.module.css";
import { IconDashboard, IconLogs, IconHandoffs, IconAgents, IconMemories, IconTerminal, IconWizard, IconMenu, IconClose } from "./icons";

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
];

interface HealthData {
  agents_healthy: number;
  agents_total: number;
  pending_handoffs: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
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

  return (
    <>
      <button className={styles.mobileToggle} onClick={() => setOpen(!open)} aria-label="Menu">
        {open ? <IconClose /> : <IconMenu />}
      </button>
      <nav className={`${styles.sidebar} ${open ? styles.open : ""}`}>
        <div className={styles.brand}>
          <Image src="/hawk-icon.png" alt="HawkAI" width={40} height={40} className={styles.brandIcon} />
          HawkAI
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
