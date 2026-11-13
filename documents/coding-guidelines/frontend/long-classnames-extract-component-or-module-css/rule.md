# Long, repeated classNames → extract a component

If you feel the urge to lift a 10+-utility className into a top-of-file `const ITEM = "flex h-8 items-center …"` so
two elements can share it, that's the smell. The string is long because it paints a *thing* — make that thing a small
component that owns the element type, the ARIA, the handlers, and the styles.

```tsx
// ❌ Wrong — a string constant shared by sibling buttons
const SEGMENT = "h-7 rounded-md px-2.5 text-sm font-medium transition-colors";
{SPANS.map(option => <button className={cn(SEGMENT, span === option.ms && "bg-accent")} … />)}
```

```tsx
// ✅ Correct — a component owns the shape and the selected state
function Segment({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "h-7 rounded-md px-2.5 text-sm font-medium transition-colors",
        selected ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
```

If the shape is generic enough for several screens (the span selector exists in `grid.tsx` and `watch.tsx`), it
belongs in `src/ui/components/ui/` next to `Button`.

Not a violation: a long className used once, inline; a `cn(...)` composing a few conditional utilities.
Watchtower has no CSS-module setup — don't add `.module.css` files for this.
