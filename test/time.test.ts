import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { wallClockOf, wallClockToUtc } from "../src/core/time.js";

describe("wall clock ↔ UTC", () => {
  it("Asia/Seoul is UTC+9", () => {
    const utc = wallClockToUtc({ year: 2026, month: 11, day: 12, hour: 9, minute: 30, second: 0 }, "Asia/Seoul");
    assert.equal(utc, Date.UTC(2026, 10, 12, 0, 30));
    assert.deepEqual(wallClockOf(utc, "Asia/Seoul"), {
      year: 2026,
      month: 11,
      day: 12,
      hour: 9,
      minute: 30,
      second: 0,
    });
  });

  it("overflowing minutes roll into the next day", () => {
    const utc = wallClockToUtc({ year: 2026, month: 11, day: 12, hour: 0, minute: 1440, second: 0 }, "Asia/Seoul");
    assert.equal(utc, Date.UTC(2026, 10, 12, 15));
  });

  it("follows DST in America/New_York", () => {
    const summer = wallClockToUtc({ year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, "America/New_York");
    const winter = wallClockToUtc({ year: 2026, month: 1, day: 1, hour: 12, minute: 0, second: 0 }, "America/New_York");
    assert.equal(summer, Date.UTC(2026, 6, 1, 16));
    assert.equal(winter, Date.UTC(2026, 0, 1, 17));
  });

  it("round-trips every hour across a DST change", () => {
    const start = Date.UTC(2026, 2, 7);
    for (let t = start; t < start + 3 * 86_400_000; t += 3_600_000) {
      assert.equal(wallClockToUtc(wallClockOf(t, "America/New_York"), "America/New_York"), t);
    }
  });
});
