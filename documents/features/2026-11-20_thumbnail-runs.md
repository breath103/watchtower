# Thumbnail index as runs

## Problem

The thumbnail index stored one row per captured slot: `thumbnails (camera_id, ts, storage_id)` with a rowid, a primary
key index on `(camera_id, ts)` and a second index on `ts`. Every slot was written three times, and the storage id was
repeated as text in each row. With 60 cameras every 30 s that is ~170k rows a day, roughly 10 MB/day of index for
nothing but "camera X has a picture at T".

## Model

Captures land on epoch-aligned slots, so a camera that keeps capturing is one fact: every `every` seconds from `start`
to `end`. The index stores those runs:

```sql
CREATE TABLE IF NOT EXISTS thumbnail_runs (
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  start INTEGER NOT NULL,      -- first slot (UTC seconds)
  end INTEGER NOT NULL,        -- last slot, inclusive
  every INTEGER NOT NULL,      -- slot spacing in seconds
  storage_id TEXT NOT NULL,
  PRIMARY KEY (camera_id, start)
) WITHOUT ROWID;
```

- Runs of one camera never overlap. A slot belongs to the run with the greatest `start <= ts`, if `ts <= end` and
  `(ts - start) % every = 0`.
- `every` is per run, not read from the camera's current frequency: changing a camera's frequency starts a new run and
  leaves the old ones readable.
- A gap (NVR offline, failed grab) ends a run; the next capture starts a new one. Gaps stay visible to the UI.

## Writes

`recordThumbnails({ cameraId, slots, every, storageId })` takes the slots in order and, for each, finds the run with
the greatest `start <= ts`:

- `ts` is inside it (held, or off its spacing) → skipped, so runs never overlap;
- it ends at `ts - every` with the same `every` and storage → extend its `end`; if the next run starts at
  `ts + every` with the same shape, merge the two;
- otherwise, if the next run starts at `ts + every` → move that run's `start` back;
- otherwise insert a one-slot run.

Live capture passes one slot and always takes the "extend" path. The S3 backfill passes a camera's listed slots in one
call, which is one transaction.

## Reads

- `GET /api/thumbnails` keeps its response (`{ ts: number[] }`): runs overlapping `[from, to]` are expanded into the
  slots inside the range.
- `GET /api/thumbnails/:camera/:ts` resolves the storage from the run that holds the slot.
- Retention (local file storages with `retentionDays`) deletes the expired slots' files run by run, then trims each
  run's `start` past the cutoff, or drops the run.

## Existing databases

On open, if the legacy `thumbnails` table exists, its rows are grouped into runs in one `INSERT … SELECT` (gaps and
islands over `ts`, using each camera's configured frequency as `every`; a change of storage also breaks a run), the
table is dropped, and the file is vacuumed to give the space back. Slots that don't fit their camera's current
frequency become one-slot runs, so nothing is lost. Back up `data/watchtower.db` before the first start on this
version.

## Key files

- `src/db/index.ts` — schema, migration, run methods
- `src/services/thumbnails.ts` — capture, backfill and retention call the run methods
- `test/thumbnail-runs.test.ts`
