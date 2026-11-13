# Use the in-house component — never hand-roll a styled clone

If `src/ui/components/ui/` (or a shared module like `src/ui/confirm.tsx`, `src/ui/tags.tsx`) already ships what you're
rendering, use it. A raw element painted with Tailwind diverges from the primitive in focus ring, hover, disabled
opacity, dark-mode contrast, keyboard handling or ARIA — invisibly, until someone notices.

| Use | Instead of |
|---|---|
| `Button` (`@/components/ui/button`, variants `default`/`outline`/`ghost`/`secondary`/`destructive`/`link`, sizes `sm`/`lg`/`icon`/`icon-sm`) | `<button className="rounded-lg bg-primary …">` |
| `Input` (`@/components/ui/input`) | raw `<input>` |
| `Checkbox`, `Switch` | `<input type="checkbox">` |
| `Select` + `SelectTrigger`/`SelectContent`/`SelectItem` | raw `<select>` or a hand-rolled dropdown |
| `Dialog` + `DialogContent`/`DialogHeader`/`DialogFooter`/… | `<div className="fixed inset-0 …">` overlays |
| `ConfirmDialog` (`src/ui/confirm.tsx`) | a bespoke "are you sure?" dialog |
| `Badge` | `<span className="rounded-full bg-…">` status chips |
| `Card`, `Table`, `Label` | re-styled `div` / `table` / `label` |
| `TagPill` (`src/ui/tags.tsx`) | re-drawn tag chips |

```tsx
// ❌ Wrong — a hand-styled button
<button type="button" className="rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent" onClick={onAdd}>
  Add storage
</button>

// ✅ Correct
<Button variant="outline" size="sm" onClick={onAdd}>
  <Plus />
  Add storage
</Button>
```

When the primitive doesn't cover the case, extend it (a new variant in `buttonVariants`, a prop on the component) or
add a new primitive under `src/ui/components/ui/` — don't clone it at the call site.

Carve-outs:
- A plain `<button type="button">` wrapping a clickable card or tile with no button chrome (`CameraCard` in
  `grid.tsx`, the play overlay in `watch.tsx`).
- Custom interactive widgets with no primitive equivalent (the `role="slider"` time tracks).

Before writing a new styled element, `ls src/ui/components/ui/`.
