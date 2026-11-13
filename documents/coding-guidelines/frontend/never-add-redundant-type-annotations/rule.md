# Never add redundant type annotations on values

Don't annotate a variable, constant or callback parameter whose type TypeScript already infers.

```tsx
// ✅ Correct — inferred from the typed client and from the data
const { nvrs } = await api("/api/nvrs", "GET");
const selected = cameras.filter(row => row.enabled).length;
```

```tsx
// ❌ Wrong — restates the inference (and goes stale when the route changes)
const result: { nvrs: NvrListEntry[] } = await api("/api/nvrs", "GET");
const selected: number = cameras.filter((row: CameraThumbCfg) => row.enabled).length;
```

Same for explicit generic arguments a value already pins. Keep a generic only when nothing else fixes the type:
`useState<NvrListEntry[] | null>(null)`, `useState<Mode>({ kind: "idle" })`, `useRef<HTMLVideoElement>(null)`.

Declared return types on named functions and arrow helpers (`const fail = (error: unknown): void => …`,
`function timeTicks(...): Array<…>`) are house style in `src/` — keep them. Components' JSX return type stays inferred.
