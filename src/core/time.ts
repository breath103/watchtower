// Helpers for connectors whose device speaks local wall-clock time: convert
// between a wall clock in an IANA time zone and UTC epoch ms.

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

export function wallClockOf(utcMs: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const wallAsUtc = (wall: WallClock): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

const offsetMs = (utcMs: number, timeZone: string): number =>
  wallAsUtc(wallClockOf(utcMs, timeZone)) - (utcMs - (((utcMs % 1000) + 1000) % 1000));

// Fields may overflow (hour 24, minute 1440) — Date.UTC normalizes them.
// Ambiguous DST wall times resolve to the later offset; skipped ones shift forward.
export function wallClockToUtc(wall: WallClock, timeZone: string): number {
  const asUtc = wallAsUtc(wall);
  const first = asUtc - offsetMs(asUtc, timeZone);
  return asUtc - offsetMs(first, timeZone);
}
