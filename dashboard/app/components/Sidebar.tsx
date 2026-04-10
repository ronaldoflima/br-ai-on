"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./Sidebar.module.css";
import { IconDashboard, IconLogs, IconHandoffs, IconAgents, IconMemories, IconTerminal, IconWizard, IconIntegrations, IconCron, IconMenu, IconClose, IconGithub, IconChevronLeft, IconChevronRight } from "./icons";

type NavItem = { href: string; label: string; icon: React.ComponentType; children?: NavItem[] };

const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: IconDashboard },
  {
    href: "/logs", label: "Logs", icon: IconLogs,
    children: [
      { href: "/logs", label: "Agentes", icon: IconLogs },
      { href: "/logs/cron", label: "Cron", icon: IconCron },
    ],
  },
  { href: "/handoffs", label: "Handoffs", icon: IconHandoffs },
  { href: "/agents", label: "Agents", icon: IconAgents },
  { href: "/wizard", label: "Wizard", icon: IconWizard },
  { href: "/terminal", label: "Terminais", icon: IconTerminal },
  { href: "/integrations", label: "Integrações", icon: IconIntegrations },
];

const CLAUDE_CODE_NAV = [
  { href: "/memories", label: "Memórias", icon: IconMemories },
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("sidebarCollapsed") === "true";
    return false;
  });
  const [health, setHealth] = useState<HealthData | null>(null);
  const [version, setVersion] = useState<VersionData | null>(null);
  const router = useRouter();

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "56px" : "220px");
    localStorage.setItem("sidebarCollapsed", String(collapsed));
  }, [collapsed]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  const isActive = (href: string, exact?: boolean) => {
    if (href === "/") return pathname === "/";
    if (exact) return pathname === href;
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
      <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} ${open ? styles.open : ""}`}>
        <div className={styles.brand}>
          <img src="/braion-icon.png" alt="BR.AI.ON" width={40} height={40} className={styles.brandIcon} />
          <span className={styles.brandText}>BR.AI.ON</span>
        </div>
        <ul className={styles.nav}>
          {NAV.map((item) =>
            item.children ? (
              <li key={item.href}>
                <span className={`${styles.navLink} ${isActive(item.href) ? styles.active : ""}`} style={{ cursor: "default" }} title={collapsed ? item.label : undefined}>
                  <span className={styles.icon}><item.icon /></span>
                  <span className={styles.navLabel}>{item.label}</span>
                </span>
                {!collapsed && (
                  <ul className={styles.subNav}>
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={`${styles.navLink} ${styles.subItem} ${isActive(child.href, true) ? styles.active : ""}`}
                          onClick={() => setOpen(false)}
                        >
                          <span className={styles.icon}><child.icon /></span>
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.navLink} ${isActive(item.href) ? styles.active : ""}`}
                  onClick={() => setOpen(false)}
                  title={collapsed ? item.label : undefined}
                >
                  <span className={styles.icon}><item.icon /></span>
                  <span className={styles.navLabel}>{item.label}</span>
                </Link>
              </li>
            )
          )}
          {!collapsed && <li className={styles.sectionLabel}>Claude Code</li>}
          {CLAUDE_CODE_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.navLink} ${styles.subItem} ${isActive(item.href) ? styles.active : ""}`}
                onClick={() => setOpen(false)}
                title={collapsed ? item.label : undefined}
              >
                <span className={styles.icon}><item.icon /></span>
                {!collapsed && item.label}
              </Link>
            </li>
          ))}
        </ul>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          {collapsed ? "↪" : "Sair"}
        </button>
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
