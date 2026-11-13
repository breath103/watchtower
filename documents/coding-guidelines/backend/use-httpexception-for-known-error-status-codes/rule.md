# Use `HTTPException` for known error status codes

In a route handler (or a helper it calls, like `cameraOpener` / `checkClipRange`), throw
`HTTPException` from `hono/http-exception` with the right status. The `onError` handler in `src/http.ts` turns it into
`{ error: { code: "http_error", message } }` with that status; a plain `Error` becomes a 500.

```ts
// ✅ Correct
import { HTTPException } from "hono/http-exception";

const nvr = db.getNvr(params.id);
if (!nvr) throw new HTTPException(404, { message: "nvr not found" });
if (db.getSetting("defaultStorage") === params.id) {
  throw new HTTPException(409, { message: "this is the default storage; make another one default first" });
}
```

```ts
// ❌ Wrong — surfaces as a 500 "internal" error
if (!nvr) throw new Error("nvr not found");
```

Notes:
- Input validation is already handled: route `query`/`body` shapes are parsed with zod, and a `ZodError` becomes a 400
  (`code: "bad_request"`). Don't hand-check what the schema can express.
- Auth is middleware (`auth.required` for `/api/*`, `requireApiKey` for `/api/v1/*`), not per-handler checks.
- Services (`src/services/`) are not HTTP-aware and may throw plain `Error`; the route checks the precondition first and
  throws the `HTTPException` (see `/api/timeline` checking `to > from` before calling `timeline.get`).
