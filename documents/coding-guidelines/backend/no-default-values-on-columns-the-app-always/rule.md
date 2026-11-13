# No `DEFAULT` on columns the app always provides

In the `SCHEMA` in `src/db/index.ts`, don't give a column a `DEFAULT` when every insert path sets it explicitly. A
default hides the bug where a new insert forgets the value — the row silently gets the default instead of failing
with a `NOT NULL constraint failed` error.

```sql
-- ✅ Correct — inserts always pass these, so a missing value fails loudly
created_at INTEGER NOT NULL,
hint TEXT NOT NULL
```

```sql
-- ❌ Wrong — every INSERT/UPSERT already passes both, the defaults are dead and mask omissions
enabled INTEGER NOT NULL DEFAULT 1,
frequency_s INTEGER NOT NULL DEFAULT 30
```

(Existing tables keep their defaults — `CREATE TABLE IF NOT EXISTS` never rewrites an existing table — but don't
repeat the pattern in new tables.)

Keep app-level defaults in one TypeScript constant (`DEFAULT_THUMBNAIL_FREQUENCY_S`) and apply them in the code path
that needs them. Use a SQL `DEFAULT` only when some inserts intentionally omit the column.
