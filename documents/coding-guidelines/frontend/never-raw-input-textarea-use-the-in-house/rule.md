# Never raw `<input>` / `<textarea>` — use the in-house `Input`

Text fields go through `Input` from `@/components/ui/input`. It owns the border, focus ring, placeholder color,
disabled look and sizing; every hand-rolled `<input className="…">` drifts from it in at least one of those.

`Input` forwards every native `<input>` prop (`value`, `onChange`, `onBlur`, `onKeyDown`, `autoFocus`, `list`,
`type`, `readOnly`) and merges `className` through `cn`, so shape tweaks are a className, not a fork.

```tsx
// ✅ Correct — size/shape via className on the primitive
<Input
  autoFocus
  aria-label={`New tag for ${label}`}
  list={listId}
  placeholder="type: value"
  className="h-6 w-44 rounded-full px-2.5 text-sm"
  value={draft}
  onChange={e => setDraft(e.target.value)}
  onBlur={commit}
/>
```

```tsx
// ❌ Wrong — a hand-rolled input with its own border, ring and padding
<input className="h-6 w-44 rounded-full border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 …" />
```

There is no `Textarea` primitive yet. If a screen needs multi-line text, add `textarea.tsx` to
`src/ui/components/ui/` in the same style as `input.tsx` and use that — don't style a raw `<textarea>` in a page.
Checkboxes and toggles use `Checkbox` / `Switch`, not `<input type="checkbox">`.
