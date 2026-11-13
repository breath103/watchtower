# Never extract a className into a named constant

Tailwind classNames live inline in JSX. Don't move a class string into `const GRID = "grid-cols-…"` and reference it
from `className={cn(…, GRID)}` — not when it's long, not when it's used twice.

- A named constant reads as a domain concept when it's only styling; the reader has to jump to see what it does.
- Duplicating a class string at two sites is fine. If the two drift, they weren't the same layout. If it's the same
  *thing* in several places, extract a component (`frontend/long-classnames-extract-component-or-module-css`).

```tsx
// ❌ Wrong
const OVERLAY_LABEL = "rounded-md bg-black/55 px-2 py-0.5 text-sm text-white backdrop-blur-md";
<span className={cn("absolute top-2 left-2", OVERLAY_LABEL)}>{camera.name}</span>
```

```tsx
// ✅ Correct
<span className="absolute top-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-sm text-white backdrop-blur-md">
  {camera.name}
</span>
```

Carve-outs:
- `cva(...)` variant tables in `src/ui/components/ui/` (`buttonVariants`, `badgeVariants`) — that's the mechanism.
- A component's `className` prop, merged with `cn()` — ordinary composition.
