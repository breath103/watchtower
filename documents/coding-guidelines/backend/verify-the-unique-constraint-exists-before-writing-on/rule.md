# Verify the unique constraint exists before writing `ON CONFLICT (col)`

SQLite rejects an upsert whose conflict target isn't a `PRIMARY KEY` or `UNIQUE` constraint ("ON CONFLICT clause does
not match any PRIMARY KEY or UNIQUE constraint") — at prepare time, i.e. the first time that code path runs, not at
startup.

Before writing `INSERT ... ON CONFLICT(col) DO UPDATE`, find the table in `SCHEMA` (`src/db/index.ts`) and confirm
`col` is its primary key or carries `UNIQUE`. If you need upsert semantics on another column, add the constraint to
the table definition first.

```ts
// ✅ Correct — camera_thumbnails.camera_id is the PRIMARY KEY
"INSERT INTO camera_thumbnails (camera_id, enabled, storage_id, frequency_s) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(camera_id) DO UPDATE SET enabled = excluded.enabled, ..."
```

```ts
// ❌ Wrong — tags' primary key is (id, type, value); there is no constraint on (id, type) alone
"INSERT INTO tags (id, type, value) VALUES (?, ?, ?) ON CONFLICT(id, type) DO UPDATE SET value = excluded.value"
```

Cover a new upsert with a test against `new Database(":memory:")` so the statement is actually prepared once in
`npm test`.
