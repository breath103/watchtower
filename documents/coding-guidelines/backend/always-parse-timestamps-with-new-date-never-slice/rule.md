# Timestamps are UTC epoch ms — format through `Date`, never slice strings

Inside Watchtower a point in time is a `number` of UTC epoch milliseconds: API query params (`from`, `to`, `start`,
`end`), `Recording.start/end`, `RawFrame.timestampMs`, `createdAt`/`lastUsedAt`. (Thumbnail `ts` is epoch
**seconds** — the one exception, named as such.) A device that speaks local wall-clock time converts at the
connector boundary with `wallClockToUtc` / `wallClockOf` from `src/core/time.ts`; nothing above the connector sees
wall-clock values.

When you need a string, build it from a `Date`. Never pull date parts out of a string by position.

```ts
// ✅ Correct — parse/format through Date
const stamp = new Date(job.start).toISOString().slice(0, 19); // slicing Date's own ISO output is fine
const utc = wallClockToUtc({ year, month, day, hour, minute, second }, timeZone);
```

```ts
// ❌ Wrong — assumes a string layout; breaks on a different format or zone suffix
const day = deviceTime.slice(0, 10);
const hour = Number(deviceTime.slice(11, 13));
```

Don't pass ISO strings or `Date` objects across the API or the connector contract — convert to epoch ms at the edge.
