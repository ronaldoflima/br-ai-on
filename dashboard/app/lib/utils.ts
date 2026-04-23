export function relativeTime(iso: string | null): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  if (mins < 1) return "agora";
  const hrs = Math.floor(mins / 60);
  if (diff < 0) {
    if (mins < 60) return `em ${mins}m`;
    if (hrs < 24) return `em ${hrs}h${mins % 60 > 0 ? `${mins % 60}m` : ""}`;
    return `em ${Math.floor(hrs / 24)}d`;
  }
  if (mins < 60) return `${mins}m atrás`;
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

export function formatTimestamp(iso: string, locale = "pt-BR"): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString(locale);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function expandCronField(field: string, min: number, max: number): number[] {
  const results = new Set<number>();
  for (const part of field.split(",")) {
    const [rangeStep, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr) : 1;
    let lo: number, hi: number;
    if (rangeStep === "*") {
      lo = min;
      hi = max;
    } else if (rangeStep.includes("-")) {
      const [a, b] = rangeStep.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      lo = parseInt(rangeStep);
      hi = lo;
    }
    for (let i = lo; i <= hi; i += step) results.add(i);
  }
  return [...results].sort((a, b) => a - b);
}

export function nextCronMatch(cronExpr: string, after: Date = new Date()): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(after.getTime() + 3600000);
  const minutes = expandCronField(parts[0], 0, 59);
  const hours = expandCronField(parts[1], 0, 23);
  const doms = expandCronField(parts[2], 1, 31);
  const months = expandCronField(parts[3], 1, 12);
  const dows = expandCronField(parts[4], 0, 6);

  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let i = 0; i < 525960; i++) {
    if (
      months.includes(d.getMonth() + 1) &&
      dows.includes(d.getDay()) &&
      doms.includes(d.getDate()) &&
      hours.includes(d.getHours()) &&
      minutes.includes(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return new Date(after.getTime() + 3600000);
}
