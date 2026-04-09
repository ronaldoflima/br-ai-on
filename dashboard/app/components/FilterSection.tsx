"use client";
import { useState } from "react";
import styles from "./FilterSection.module.css";

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

interface FilterSectionProps {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
  maxVisible?: number;
}

export function FilterSection({
  title,
  options,
  selected,
  onToggle,
  defaultOpen = true,
  maxVisible = 8,
}: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);

  const sorted = [...options].sort((a, b) => b.count - a.count);
  const visible = showAll ? sorted : sorted.slice(0, maxVisible);
  const hasMore = sorted.length > maxVisible;
  const activeCount = options.filter((o) => selected.has(o.value)).length;

  return (
    <div className={styles.section}>
      <button
        className={styles.sectionHeader}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className={styles.chevron} data-open={open}>&#9656;</span>
        <span className={styles.title}>{title}</span>
        {activeCount > 0 && (
          <span className={styles.activeBadge}>{activeCount}</span>
        )}
      </button>
      {open && (
        <div className={styles.sectionBody}>
          {visible.map((opt) => (
            <label key={opt.value} className={styles.checkItem}>
              <input
                type="checkbox"
                checked={selected.has(opt.value)}
                onChange={() => onToggle(opt.value)}
              />
              <span className={styles.checkLabel}>{opt.label}</span>
              <span className={styles.count}>{opt.count}</span>
            </label>
          ))}
          {hasMore && (
            <button
              className={styles.showMoreBtn}
              onClick={() => setShowAll(!showAll)}
              type="button"
            >
              {showAll ? "Mostrar menos" : `+ ${sorted.length - maxVisible} mais`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface FilterSidebarProps {
  children: React.ReactNode;
  mobileLabel?: string;
}

export function FilterSidebar({ children, mobileLabel = "Filtros" }: FilterSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={styles.sidebar} data-mobile-open={mobileOpen}>
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        type="button"
      >
        <span>{mobileLabel}</span>
        <span className={styles.chevron} data-open={mobileOpen}>&#9656;</span>
      </button>
      <div className={styles.sidebarContent} data-mobile-open={mobileOpen}>
        {children}
      </div>
    </div>
  );
}
