# Guard async results that depend on changing values

A request whose result depends on a value that can change while the component stays mounted (the selected camera,
the time window, the stream) must not let a stale response overwrite a newer one. The effect that starts the request
cancels it in its cleanup.

Prefer aborting: the typed client takes a `signal`, so the old request is actually cancelled, not just ignored.

```tsx
// ✅ Correct — abort the previous request when the window changes
useEffect(() => {
  const controller = new AbortController();
  void api("/api/thumbnails", "GET", { query: { camera: cameraId, from, to }, signal: controller.signal }).then(
    index => setThumbs(index.ts.map(ts => ts * 1000)),
    () => {
      if (!controller.signal.aborted) setThumbs([]);
    }
  );
  return () => controller.abort();
}, [cameraId, from, to]);
```

```tsx
// ✅ Also correct — when the work can't take a signal, a cancelled flag (src/ui/watch.tsx timeline effect)
let cancelled = false;
void api("/api/timeline", "GET", { query }).then(response => {
  if (!cancelled) setRecordings(...);
});
return () => {
  cancelled = true;
};
```

```tsx
// ❌ Wrong — scrubbing quickly fires several requests; whichever resolves last wins
useEffect(() => {
  void api("/api/thumbnails", "GET", { query: { camera: cameraId, from, to } }).then(index => setThumbs(...));
}, [cameraId, from, to]);
```

The invariant: only the latest request for this mounted component may update its state. On abort, the client rejects
— swallow that rejection instead of showing it as an error.
