# Don't invent per-field side-endpoints — decorate the parent resource

When a resource needs a derived value (a URL, a joined name, a computed state), return it on the parent's response,
not from a dedicated endpoint. A side-endpoint is one more route to keep, one more round trip, and one more lookup of
the same record.

```ts
// ✅ Correct — the clip job carries its own download URL (src/api/helpers.ts publicJob)
export const publicJob = (job: ClipJob) => ({
  id: job.id,
  status: job.status,
  // ...
  videoUrl: job.status === "ready" ? `/api/clips/${job.id}/video.mp4` : null,
});
```

```ts
// ❌ Wrong — a route that re-reads the same job just to hand back one derived field
route("/api/clips/:id/video-url", "GET", {
  handler: ({ params }) => ({ url: `/api/clips/${params.id}/video.mp4` }),
}),
```

Same for `publicCamera`'s `thumbnail: { every } | null` and the `state` on `/api/thumbnails/config` rows.

Exception: the derivation is expensive (it hits a device, decodes video), or most callers want the parent without it.
Then a separate endpoint earns its keep — e.g. `/api/timeline` asks the NVR for recordings and is not folded into
`/api/nvrs`.
