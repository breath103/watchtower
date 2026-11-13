# Structured logs and the Logs page

## Summary

Every log line in the server becomes a structured entry, `logger.log({ level, message, ...fields })`, instead of a
formatted string. Entries print to stdout as before and are kept in SQLite, and a new **Logs** page (`/logs`) lets
the admin browse, filter and search them, with new entries appearing as they happen.

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
- `log` never throws: if the database write fails (e.g. during shutdown, after the DB closes), the entry still
  prints to stdout.
- Example:

  ```ts
  this.logger.log({ level: "warn", message: "thumbnail failed", camera: cfg.cameraId, error });
  ```

### Output

- **stdout** stays one readable line per entry, so `npm start` output and `data/` log files stay greppable:
  `08:09:12 warn  thumbnails  thumbnail failed  camera=c1ch1 error="skipped (no keyframe)"`.
- **SQLite** gets the structured entry.

## Model

```sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,       -- ms since epoch
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  fields TEXT NOT NULL       -- JSON object of everything else
);
CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
```

- Why a table: the page must show what happened before a restart (restarts and crashes are exactly when the admin
  looks), and filter by level/scope/text. An in-memory buffer loses that, and reading `data/` log files back means
  parsing text.
- Context fields stay in one JSON column instead of `nvr`/`camera` columns: the text search matches them
  (`c1ch1` finds every entry about that camera), and new fields need no schema change.
- Retention: entries older than 7 days are deleted hourly, and the table is capped at 100,000 rows.
- Existing databases get the table on the next start (`CREATE TABLE IF NOT EXISTS`); nothing to migrate. Back up
  `data/watchtower.db` first as usual.

## API

`GET /api/logs` (admin session, like every internal route):

| query | |
|---|---|
| `level` | minimum level: `info` (default), `warn`, `error` |
| `scope` | one scope; omitted = all |
| `q` | case-insensitive text match on message and fields |
| `before` | entry id; returns entries older than it (paging) |
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
- **Load older** at the bottom fetches the next page with `before`.

## Call sites converted

All ~50 `log(…)` calls in `src/` move to `logger.log({…})`, and every `log: (line: string) => void` parameter
becomes `logger: Logger`, including the connector contract (`src/core/connector.ts`) and the storage contract
(`src/storage/types.ts`). The two `console.*` calls in `src/index.ts` go through the logger too. `scripts/` keep
`console.log`: they are CLI output, not server logs.

## Rejected

- JSON lines on stdout: structured, but unreadable in the terminal that runs `npm start`, and the Logs page already
  serves structured browsing.
- A logging library (pino, winston): one more dependency for what is a 60-line module here; nothing needs
  transports or log rotation.
- A `debug` level: no call site needs it today.

## Risks

- Contract change: a third-party connector or storage written against `log: (line) => void` must switch to
  `logger`. All in-tree implementations are converted in this change.
- A camera that fails every 30s writes ~2,900 rows a day; the 7-day / 100k cap bounds it.
