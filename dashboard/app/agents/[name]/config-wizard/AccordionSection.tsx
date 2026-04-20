"use client";
import { useState } from "react";
import styles from "./config-wizard.module.css";

interface Props {
  title: string;
  hasError?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function AccordionSection({
  title,
  hasError,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.accordionItem}>
      <button
        type="button"
        className={`${styles.accordionHeader} ${hasError ? styles.accordionHeaderError : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span
          className={`${styles.accordionChevron} ${open ? styles.accordionChevronOpen : ""}`}
        >
          ▼
        </span>
      </button>
      {open && <div className={styles.accordionBody}>{children}</div>}
    </div>
  );
}
