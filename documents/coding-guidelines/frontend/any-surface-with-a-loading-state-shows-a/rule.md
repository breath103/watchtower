# Loading is not empty — never show the empty state while the first fetch is in flight

Every surface that loads data distinguishes three states, and renders a different thing for each:

| Condition | Render |
|---|---|
| not loaded yet | a placeholder that keeps the layout's footprint (or nothing, for a page-level first paint) |
| loaded, no content | the empty state ("No NVRs connected.", "No API keys yet.") |
| loaded, has content | the content |

Model "not loaded yet" as `null`, not as an empty array — `useState<T[] | null>(null)` — so the two can't be confused.
Starting with `useState<T[]>([])` makes the empty state flash for every user on every load, which reads as "my data is
gone".

```tsx
// ✅ Correct — src/ui/grid.tsx: null = loading, [] = genuinely empty
const [nvrs, setNvrs] = useState<NvrListEntry[] | null>(null);
// render: null → nothing yet; [] → "No NVRs connected."; else → the grid
```

```tsx
// ❌ Wrong — "No API keys yet." shows during the initial request
const [keys, setKeys] = useState<ApiKey[]>([]);
{keys.length === 0 ? <p>No API keys yet.</p> : <Table>…</Table>}
```

Never replace a content area with a centered spinner; it reserves no space and the layout jumps when data lands.
Watchtower has no `Skeleton` primitive; if a surface needs a visible placeholder, add one to `src/ui/components/ui/`
rather than hand-rolling `animate-pulse` divs per screen.
