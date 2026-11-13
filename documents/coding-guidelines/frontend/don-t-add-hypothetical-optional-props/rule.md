# Don't add hypothetical optional props

When extracting a component, ship only the props current callers pass. A `size` knob nobody sets to a non-default, a
`className` "for flexibility" with one caller, a `variant` "in case we reuse it" — all widen the API, multiply the
permutations a reader must consider, and rot (the unused path breaks silently when the default is tuned).

Add the optional prop when a second caller actually needs a different value.

```tsx
// ❌ Wrong — none of these are passed by any caller
export function CameraName({
  name,
  size = "md",
  truncate = true,
  className,
}: { name: string; size?: "sm" | "md"; truncate?: boolean; className?: string }) { ... }
```

```tsx
// ✅ Correct — exactly what callers use today
export function CameraName({ name }: { name: string }) { ... }
```

`TagPill`'s `onRemove` and `className` are fine: `TagEditor` passes `onRemove` and the camera tile passes `className`.
