# Never use `""` to mean "no value" — use `null`

An empty string is a value (a user cleared a field). Absence is `null`. Using `""` as "missing" makes the type claim
"always a string" and pushes every reader into truthiness guesses.

```ts
// ✅ Correct — absence is null, in the type and on the wire
interface ApiKeyRecord {
  lastUsedAt: number | null;
}
const storage = hub.get()?.label ?? null;
```

```ts
// ❌ Wrong — "" as a sentinel
function storageLabel(): string {
  return hub.get()?.label ?? "";
}
```

Applies to function returns, record fields, API responses and sqlite columns (nullable column → `T | null`, e.g.
`storage_id TEXT` → `storageId: string | null`). Existing `?? ""` spots in API responses (`description: def.description
?? ""`) are legacy — don't copy them into new endpoints.
