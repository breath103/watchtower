# Structured logs and the Logs page

## Summary

Every log line in the server becomes a structured entry, `logger.log({ level, message, ...fields })`, instead of a
formatted string, and the server logs everything it does: every thumbnail capture, every API request, every
connection change. Entries go to one place: daily JSON-lines files that rotate at midnight UTC and are deleted
after 7 days. A new **Logs** page (`/logs`) lets the admin browse, filter and search
them, with new entries appearing as they happen.

## Before

- `src/index.ts` has a single `log(message: string)` that calls `console.log` with a time prefix.
- That function is threaded everywhere as `log: (line: string) => void`: the services, `createApp`/routes,
  `http.ts`, and the connector and storage contracts. Context is baked into the string (`` `${nvrId}: …` `` prefixes
  added by the pool, `` `${camera}: clip ${id} failed: …` ``), so nothing can be filtered by camera, NVR or severity.
- Logs exist only in `data/` stdout redirects; the admin can't see them in the app.

## Logger

`src/core/logger.ts`:

```ts
type LogLevel = "info" | "warn" | "error";

interface LogInput {
  level: LogLevel;
  message: string;            // short, constant text: "thumbnail failed", not "c1ch1: thumbnail failed"
  [field: string]: unknown;   // context: camera, nvr, clip, storage, error, count, …
}

interface Logger {
  log(input: LogInput): void;
  with(fields: Record<string, unknown>): Logger; // a logger that adds these fields to every entry
}
```

- Every subsystem gets a logger with its `scope` bound at wiring time: `logger.with({ scope: "thumbnails" })`. The
  pool hands each connection `logger.with({ scope: "nvr", nvr: nvrId })` in place of today's `` `${nvrId}: ` ``
  prefix. Scopes: `server`, `api`, `nvr`, `thumbnails`, `clips`, `live`, `storage`.
- `error: unknown` values are normalized (an `Error` becomes its message), so call sites pass the caught value
  directly instead of repeating `error instanceof Error ? error.message : String(error)`.
- `log` never throws: a write that fails (disk full, after shutdown closed the file) is dropped.
- Example:

  ```ts
  this.logger.log({ level: "warn", message: "thumbnail failed", camera: cfg.cameraId, error });
  ```

### Output

One output: each entry is one JSON line in `<workDir>/logs/watchtower-YYYY-MM-DD.jsonl` (UTC date). The logger
prints nothing to stdout; stdout carries only what the logger can't catch (a crash, a failure before the logger
exists). To follow it live: `tail -f data/logs/watchtower-$(date -u +%F).jsonl`, or the Logs page.

## What gets logged

- Every thumbnail capture: `thumbnail captured` (camera, slot, storage, bytes) or `thumbnail failed` (camera,
  reason), plus one `capture round` per slot (cameras, duration).
- Every `/api/*` request: method, path, status, duration. 5xx is `error`, 4xx is `warn`. The Logs page's own
  polling (`GET /api/logs`) is not logged, or the page would fill itself.
- Everything logged today, converted: NVR connects and disconnects, channel failures, live and clip streams, clip
  jobs, storage and NVR changes, logins, API keys, tags, retention.
- Unhandled request errors and startup failures, with the stack.

## Storage: rotating files

`src/services/log-files.ts` (`LogFiles`):

- One file per UTC day, `watchtower-YYYY-MM-DD.jsonl`, appended through a write stream; a new day closes the old
  stream and opens the next file.
- Each line is `{ id, ts, level, scope, message, fields }`. `id` is a strictly increasing number derived from the
  time (`ts * 1000`, bumped on collisions), so it orders entries and serves as the paging cursor across restarts.
- Retention: files older than 7 days are deleted at startup and hourly.
- Reading: files newest first, each read backwards in chunks, so the newest page (and the page's 5s refresh)
  touches only the end of today's file. Filters apply while scanning; it stops at `limit` matches.
- A write that fails (disk full, shutdown) is dropped; logging never takes the server down.

Volume: logging every capture is ~120 entries a minute with 60 cameras on a 30s frequency, roughly 25 MB a day,
175 MB at the 7-day limit.

Why files instead of a SQLite table: the volume of logging everything would bloat the database that holds the
NVR config, and a table needs row caps that push old entries out early. Files rotate and delete with no
bookkeeping, and can be read with ordinary tools (`tail`, `jq`).

## API

`GET /api/logs` (admin session, like every internal route):

| query | |
|---|---|
| `level` | minimum level: `info` (default), `warn`, `error` |
| `scope` | one scope; omitted = all |
| `q` | case-insensitive text match on message and fields |
| `before` | entry id; returns entries older than it (Load older) |
| `after` | entry id; returns only entries newer than it (the page's refresh, which then reads only the end of today's file) |
| `limit` | default 200, max 500 |

Response: `{ entries: LogEntry[] }`, newest first, `LogEntry = { id, ts, level, scope, message, fields }`.

## UI

- A **Logs** item in the header nav, between Cameras and Settings, at `/logs`.
- Toolbar: level select (All / Warnings and errors / Errors), scope select (All + each scope), search input. All
  three are kept in the URL (`?level=&scope=&q=`).
- Table, newest first: time (local `HH:MM:SS`, full date on hover), level badge (error = destructive, warn =
  amber, info = muted), scope, message, then fields as muted `key=value` chips. Text is `text-sm`, monospace for
  fields.
- Live: the first page refreshes every 5 seconds while the tab is visible; new rows appear on top.
- With everything logged, the default view is busy; the level filter (Warnings and errors) is the quick way to see
  problems.
- **Load older** at the bottom fetches the next page with `before`.

## Call sites converted

All ~50 `log(…)` calls in `src/` move to `logger.log({…})`, and every `log: (line: string) => void` parameter
becomes `logger: Logger`, including the connector contract (`src/core/connector.ts`) and the storage contract
(`src/storage/types.ts`). The two `console.*` calls in `src/index.ts` go through the logger too. `scripts/` keep
`console.log`: they are CLI output, not server logs.

## Rejected

- stdout as the log (with an external rotator): the server can't rotate or delete its own stdout, and the Logs page
  needs to read the log back from a place the server controls.
- stdout and files both: two outputs carrying the same entries, only one of them rotated.
- A logging library (pino, winston): one more dependency for what is a 60-line module here; nothing needs
  transports or log rotation.
- A `debug` level: no call site needs it today.

## Risks

- Contract change: a third-party connector or storage written against `log: (line) => void` must switch to
  `logger`. All in-tree implementations are converted in this change.
- A filter that rarely matches (Errors only, an uncommon search term) scans up to 7 days of files on first load:
  measured ~0.6–0.8 s over 210 MB. The newest page (~4 ms) and the refresh with `after` (~7 ms) stay cheap.
