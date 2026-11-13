# Inline single-use schemas and variables

Don't extract a variable for something used once. A route's zod shape is declared inline in its `route()` call.

```ts
// ✅ Correct — inline body shape
route("/api/keys", "POST", {
  body: { name: z.string().trim().min(1).max(100) },
  handler: ({ body }) => ...,
}),
```

```ts
// ❌ Wrong — named once, used once
const createKeyBody = { name: z.string().trim().min(1).max(100) };

route("/api/keys", "POST", { body: createKeyBody, handler: ... }),
```

Name it the moment a second consumer exists: `wizardBody` (shared by `/api/nvrs/test` and `/api/nvrs/discover`),
`clipQuery` (the `/api/clips` body and the `/api/clips/stream` query), `tagSchema` (route body + tests) are named
because they are reused.
