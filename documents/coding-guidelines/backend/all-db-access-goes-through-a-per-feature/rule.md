# All SQL lives in the `Database` class — nothing else touches `node:sqlite`

Every read and write is a method on `Database` in `src/db/index.ts`. Routes, services, scripts and tests call
`db.listNvrs()`, `db.setTags(...)`, `db.upsertStorage(...)` — they never import `node:sqlite`, never hold a
`DatabaseSync`, and never call `.prepare(...)` themselves.

Why one class: the schema, the row ↔ record mapping (`cameraFromRow`, `apiKeyFromRow`), the JSON blob encoding,
the `as unknown as Row` casts node:sqlite forces, and transactions (`this.transaction(...)`) all stay in one file. A
handler that writes its own SQL bypasses all of that.

```ts
// ✅ Correct — the route asks the Database for what it needs
route("/api/keys/:id", "DELETE", {
  handler: ({ params }) => {
    if (!db.deleteApiKey(params.id)) throw new HTTPException(404, { message: "api key not found" });
    return { ok: true };
  },
}),
```

```ts
// ❌ Wrong — SQL in a route handler
handler: ({ params }) => {
  const { changes } = sqlite.prepare("DELETE FROM api_keys WHERE id = ?").run(params.id);
  ...
}
```

Validation that needs a lookup (does this NVR exist? is this storage the default?) calls a `Database` method too —
`db.getNvr(id)`, `db.getSetting("defaultStorage")`. Multi-statement writes that must be atomic get one method that
wraps them in `this.transaction(...)` (see `insertNvr`, `deleteStorage`).

`check.sh` fails if `node:sqlite`, `DatabaseSync` or `.prepare(` appears in `src/`, `scripts/` or `test/` outside
`src/db/`.
