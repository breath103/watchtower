# Never force-cast API client responses

`api(path, method, options)` (`src/ui/api.ts`, built on `createWatchtowerClient` in `src/client.ts`) returns the
route handler's actual return type. If you're writing `as SomeType` or `as unknown as …` on its result, you're hiding a
mismatch — fix the handler's return value or the consumer, don't cast it away.

```ts
// ✅ Correct — the type comes from the route
const { nvrs } = await api("/api/nvrs", "GET");
type NvrListEntry = ApiResponse<"/api/nvrs", "GET">["nvrs"][number];
```

```ts
// ❌ Wrong — a cast that silently survives the next route change
const nvrs = (await api("/api/nvrs", "GET")) as unknown as { nvrs: MyNvr[] };
```

The same holds for path/query/body: if `api(...)` rejects your options, the route's zod shape and your call disagree —
change one of them.

The only casts allowed are inside the client implementation itself (`src/client.ts`), where the generic plumbing meets
`fetch`.
