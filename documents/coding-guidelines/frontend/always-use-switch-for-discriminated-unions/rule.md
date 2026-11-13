# Always use `switch` for discriminated unions (and any string-literal mode union)

When handling a discriminated union or any string-literal union (a `mode.kind`, a `Source["kind"]`, a status), use a
`switch` on the discriminant. Never a nested ternary, never an `if`/`else if` chain. A `switch` whose cases each
`return` is exhaustiveness-checked by `tsc`; a ternary chain silently routes a new variant into its last arm.

Same rule as `backend/always-use-switch-for-discriminated-unions`. The UI breaks it more often because JSX expression
positions invite nested ternaries.

```tsx
// ❌ Wrong — a new Mode kind silently lands in the last arm
const caption =
  mode.kind === "live"
    ? "Live"
    : mode.kind === "recording"
      ? "Recording"
      : thumb !== null ? `Thumbnail ${clock(thumb)}` : "No thumbnail at this time";
```

```tsx
// ✅ Correct — extracted switch; adding a Mode kind fails typecheck until handled
function captionFor(mode: Mode, thumb: number | null): string {
  switch (mode.kind) {
    case "live":      return "Live";
    case "recording": return "Recording";
    case "idle":      return thumb !== null ? `Thumbnail ${clock(thumb)}` : "No thumbnail at this time";
  }
}
```

In a render position, an inline IIFE with a `switch` is fine (see
`frontend/multi-branch-render-inline-iife-with-if-else`). Group shared outputs with stacked `case` labels.

A single boolean `cond ? a : b` is allowed — the rule starts at the second `?`.
