# Use typed error classes when available

When branching on an error, use `instanceof` with the library's (or our) error class — not duck typing on
`error.name`, `error.code` or the message text.

```ts
// ✅ Correct — src/http.ts onError
if (error instanceof HTTPException) return c.json(..., error.status);
if (error instanceof ZodError) return c.json({ error: { code: "bad_request", message: z.prettifyError(error) } }, 400);

// ✅ Correct — callers of the typed client
try {
  await api("/api/nvrs/:id", "GET", { params: { id } });
} catch (error) {
  if (error instanceof WatchtowerError && error.status === 404) return null;
  throw error;
}
```

```ts
// ❌ Wrong — string matching that breaks on any rewording
if (error instanceof Error && error.message.includes("not found")) return null;
if ((error as { name?: string }).name === "ZodError") ...
```

`WatchtowerError` (`src/ui/api.ts`) carries `status` and `code` from the server's `{ error: { code, message } }` body.
When an SDK exports typed errors (e.g. `@aws-sdk/client-s3`'s `NoSuchKey`), check for those instead of catching
everything.
