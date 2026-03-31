"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDots?: boolean;
  fillGradient?: boolean;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  showDots = false,
  fillGradient = true,
}: SparklineProps) {
  if (!data.length || data.every((v) => v === 0)) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />
      </svg>
    );
  }

  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * w;
    const y = padding + h - ((val - min) / range) * h;
    return { x, y };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const gradientId = `sparkGrad-${Math.random().toString(36).slice(2, 8)}`;

  const fillPoints = [
    `${points[0].x},${height}`,
    ...points.map((p) => `${p.x},${p.y}`),
    `${points[points.length - 1].x},${height}`,
  ].join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fillGradient && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={fillPoints} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDots && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
      ))}
    </svg>
  );
}
