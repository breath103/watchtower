# Don't wrap `api(...)` in thin "rename" helpers

`api(path, method, options)` from `src/ui/api.ts` is already typed end to end. A same-shape wrapper that only gives it
a nicer name hides the endpoint from the call site, restates types, and adds a hop for every reader.

A wrapper earns its place only when it:

- combines several requests into one operation (`saveRecording` in `src/ui/viewport.ts`: create job → poll → download),
- adds behavior every call needs (timeouts, retries, caching),
- or narrows / validates the response beyond the route's type.

```ts
// ❌ Wrong — pure rename
export function listNvrs() {
  return api("/api/nvrs", "GET");
}
```

```ts
// ✅ Correct — call it where it's used; the path and method are visible
const { nvrs } = await api("/api/nvrs", "GET");
```
