# Never add redundant type annotations on values

Don't annotate a variable, constant or callback parameter whose type TypeScript already infers.

```ts
// ✅ Correct — inferred
const nvr = db.getNvr(params.id);
const ids = cameras.map(camera => camera.id);
const configs = new Map(db.listThumbnailConfigs().map(cfg => [cfg.cameraId, cfg]));
```

```ts
// ❌ Wrong — restates what the compiler knows
const nvr: NvrRecord | null = db.getNvr(params.id);
const ids: string[] = cameras.map((camera: CameraRecord) => camera.id);
```

Same for explicit generic arguments a value already pins (`new Map<string, ThumbnailConfig>(entries)`). Keep a
generic only when nothing else fixes the type: `new Map<string, ConnectorConnection>()`, `useState<Mode | null>(null)`.

Not covered by this rule: **declared return types on functions** (`function slug(value: string): string`,
`close(): void`). Watchtower writes those on purpose throughout `src/`; keep doing so for named functions and
methods. When the return type is a big derived shape (`publicJob`, `apiRoutes`), leave it inferred — the typed API
client reads it.
