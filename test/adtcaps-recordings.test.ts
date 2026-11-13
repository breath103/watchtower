import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clipAndMerge,
  localDaysCovering,
  MINUTES_PER_DAY,
  recordingsFromMinuteMap,
} from "../src/connectors/vendors/adtcaps/recordings.js";

const TZ = "Asia/Seoul";
const map = (...ranges: Array<[number, number]>): Uint8Array => {
  const minutes = new Uint8Array(MINUTES_PER_DAY);
  for (const [from, to] of ranges) minutes.fill(1, from, to);
  return minutes;
};

describe("adtcaps minute maps", () => {
  it("turns local-minute runs into UTC spans", () => {
    const recs = recordingsFromMinuteMap("c", { year: 2026, month: 11, day: 12 }, map([0, 60], [600, 601]), TZ);
    assert.deepEqual(recs, [
      { cameraId: "c", start: Date.UTC(2026, 10, 11, 15), end: Date.UTC(2026, 10, 11, 16) },
      { cameraId: "c", start: Date.UTC(2026, 10, 12, 1), end: Date.UTC(2026, 10, 12, 1, 1) },
    ]);
  });

  it("closes a run that reaches midnight", () => {
    const recs = recordingsFromMinuteMap("c", { year: 2026, month: 11, day: 12 }, map([1380, 1440]), TZ);
    assert.deepEqual(recs, [{ cameraId: "c", start: Date.UTC(2026, 10, 12, 14), end: Date.UTC(2026, 10, 12, 15) }]);
  });

  it("covers every local day a UTC range touches", () => {
    const days = localDaysCovering(Date.UTC(2026, 10, 11, 14), Date.UTC(2026, 10, 12, 16), TZ);
    assert.deepEqual(days, [
      { year: 2026, month: 11, day: 11 },
      { year: 2026, month: 11, day: 12 },
      { year: 2026, month: 11, day: 13 },
    ]);
    assert.deepEqual(localDaysCovering(Date.UTC(2026, 10, 12, 15), Date.UTC(2026, 10, 12, 15), TZ), []);
  });

  it("merges spans across midnight and clips to the range", () => {
    const day1 = recordingsFromMinuteMap("c", { year: 2026, month: 11, day: 12 }, map([1380, 1440]), TZ);
    const day2 = recordingsFromMinuteMap("c", { year: 2026, month: 11, day: 13 }, map([0, 30]), TZ);
    const other = recordingsFromMinuteMap("b", { year: 2026, month: 11, day: 13 }, map([0, 10]), TZ);
    const merged = clipAndMerge([...day2, ...other, ...day1], Date.UTC(2026, 10, 12, 14, 30), Date.UTC(2026, 10, 13));
    assert.deepEqual(merged, [
      { cameraId: "b", start: Date.UTC(2026, 10, 12, 15), end: Date.UTC(2026, 10, 12, 15, 10) },
      { cameraId: "c", start: Date.UTC(2026, 10, 12, 14, 30), end: Date.UTC(2026, 10, 12, 15, 30) },
    ]);
  });
});
