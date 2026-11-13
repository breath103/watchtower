// The device answers recording queries per local calendar day as a 1440-byte
// map (one byte per minute, non-zero = recorded). These helpers turn those
// maps into UTC Recording spans.

import type { Recording } from "../../../core/connector.js";
import { wallClockOf, wallClockToUtc } from "../../../core/time.js";

export const MINUTES_PER_DAY = 1440;

export interface LocalDay {
  year: number;
  month: number;
  day: number;
}

export const dayNumber = (day: LocalDay): number => day.year * 10_000 + day.month * 100 + day.day;

const DAY_MS = 86_400_000;

export function localDaysCovering(fromMs: number, toMs: number, timeZone: string): LocalDay[] {
  if (toMs <= fromMs) return [];
  const first = wallClockOf(fromMs, timeZone);
  const last = wallClockOf(toMs - 1, timeZone);
  const days: LocalDay[] = [];
  const end = Date.UTC(last.year, last.month - 1, last.day);
  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); cursor <= end; cursor += DAY_MS) {
    const date = new Date(cursor);
    days.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  }
  return days;
}

export function recordingsFromMinuteMap(
  cameraId: string,
  day: LocalDay,
  minutes: Uint8Array,
  timeZone: string
): Recording[] {
  const at = (minute: number): number => wallClockToUtc({ ...day, hour: 0, minute, second: 0 }, timeZone);
  const out: Recording[] = [];
  let start: number | null = null;
  for (let minute = 0; minute <= MINUTES_PER_DAY; minute++) {
    const recorded = minute < MINUTES_PER_DAY && (minutes[minute] ?? 0) !== 0;
    if (recorded && start === null) start = minute;
    if (!recorded && start !== null) {
      out.push({ cameraId, start: at(start), end: at(minute) });
      start = null;
    }
  }
  return out;
}

// Clip to [fromMs, toMs), join spans that touch across day boundaries, and
// sort by camera then start.
export function clipAndMerge(recordings: Recording[], fromMs: number, toMs: number): Recording[] {
  const clipped = recordings
    .map(rec => ({ ...rec, start: Math.max(rec.start, fromMs), end: Math.min(rec.end, toMs) }))
    .filter(rec => rec.end > rec.start)
    .sort((a, b) => (a.cameraId === b.cameraId ? a.start - b.start : a.cameraId < b.cameraId ? -1 : 1));
  const out: Recording[] = [];
  for (const rec of clipped) {
    const prev = out.at(-1);
    if (prev && prev.cameraId === rec.cameraId && rec.start <= prev.end) prev.end = Math.max(prev.end, rec.end);
    else out.push({ ...rec });
  }
  return out;
}
