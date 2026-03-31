"use client";

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  showPercentage?: boolean;
}

export function ProgressBar({ value, max, label, showPercentage = true }: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const colorClass = pct >= 80 ? "progress-red" : pct >= 50 ? "progress-yellow" : "progress-green";

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="flex-between" style={{ marginBottom: 4 }}>
        <span className="text-muted-xs">{label}</span>
        {showPercentage && (
          <span className="text-muted-xs">{Math.round(pct)}%</span>
        )}
      </div>
      <div className="progress-bar">
        <div className={`progress-bar-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
