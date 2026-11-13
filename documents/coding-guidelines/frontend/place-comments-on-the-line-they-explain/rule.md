# Place comments on the line they explain

When a comment explains one specific line — a timeout, a race, one clause of a condition — put it directly above (or
beside) that line, not in a block at the top of the function that catalogs the body.

```ts
// ✅ Correct — src/http.ts: the comment sits on the statement it justifies
// The pump's verdict is authoritative; bound the wait so a stalled
// client can never hang this callback.
const settled = await Promise.race([
  info.done,
  new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
]);
```

```ts
// ✅ Correct — src/ui/viewport.ts: the reason for an empty catch, inside the catch
} catch {
  // aborted or the source went away; the caller's signal owns teardown
}
```

```ts
// ❌ Wrong — a header listing what each later line does; the reader matches them up by hand
// - races the pump against 2s so a stalled client can't hang us
// - swallows read errors because the signal owns teardown
// - finishes the cache entry only when the clip completed
async function finishStream(...) { ... }
```

Fine at the top: a 1–3 line statement of the function's **purpose** (`// Resolves once the video is playing; keeps
feeding MSE in the background until the stream ends or the signal aborts.`), JSDoc on exported APIs, and one block
for several lines that share a single rationale.

Whether to comment at all: `frontend/comment-non-obvious-code`.
