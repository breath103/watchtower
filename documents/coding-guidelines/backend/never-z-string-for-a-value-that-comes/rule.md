# Never `z.string()` for a value from a known, closed set

When a request field can only take a fixed set of values, pin it in the schema with `z.enum([...])` (or
`z.literal`, or `z.discriminatedUnion` when one field constrains another). A free `z.string()` lets anything
through, makes every handler re-check membership, and types the field as `string` instead of a literal union.

```ts
// ✅ Correct — the only transcode target is h264 (src/api/helpers.ts clipQuery)
transcode: z.enum(["h264"]).optional(),
```

```ts
// ❌ Wrong — "hevc" or "" slips through; handler must re-validate
transcode: z.string().optional(),
```

Carve-out: ids that are open at runtime — connector ids, storage type ids, NVR/camera ids — stay `z.string()` and are
resolved through the registry or the database (`registry.connector(body.connector)`, `db.getCamera(id)`), which
throws / 404s on unknown values. Those sets are filled at bootstrap, not known to the type system.
