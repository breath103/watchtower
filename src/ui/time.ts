export function ago(value: number | null, isSeconds: boolean): string {
  if (!value) return "never";
  const ms = isSeconds ? value * 1000 : value;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const HOUR = 3_600_000;

export const SPANS = [
  { label: "1h", ms: HOUR },
  { label: "6h", ms: 6 * HOUR },
  { label: "24h", ms: 24 * HOUR },
  { label: "7d", ms: 7 * 24 * HOUR },
];

const TICK_STEPS = [5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080].map(min => min * 60_000);

export const clock = (ms: number, seconds = true): string =>
  new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
  });
export const day = (ms: number): string => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
export const stamp = (ms: number): string => `${day(ms)} ${clock(ms)}`;

// At most ~8 ticks on local-time boundaries across [start, end].
export function timeTicks(start: number, end: number): Array<{ t: number; label: string }> {
  const span = Math.max(1, end - start);
  const step = TICK_STEPS.find(candidate => span / candidate <= 8) ?? 30 * 24 * HOUR;
  const offset = new Date().getTimezoneOffset() * 60_000;
  const label = (t: number): string =>
    step >= 24 * HOUR ? day(t) : span > 24 * HOUR ? `${day(t)} ${clock(t, false)}` : clock(t, false);
  const out: Array<{ t: number; label: string }> = [];
  for (let t = Math.ceil((start - offset) / step) * step + offset; t <= end; t += step)
    out.push({ t, label: label(t) });
  return out;
}
