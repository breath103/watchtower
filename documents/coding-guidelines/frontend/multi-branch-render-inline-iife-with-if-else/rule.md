# Multi-branch render: inline IIFE with `if`/`else if` — never nested ternaries

When a render position chooses between **three or more** outputs (loading / empty / content; one view per mode),
don't chain ternaries. Use an immediately-invoked arrow with plain `if` / `else if` / `else` (or a `switch` for a
literal union) that `return`s each branch.

```tsx
// ❌ Wrong — each new state re-nests the pyramid
{nvrs === null ? null : nvrs.length === 0 ? (
  <p className="py-24 text-center text-sm text-muted-foreground">No NVRs connected.</p>
) : (
  <div className="grid …">{nvrs.map(…)}</div>
)}
```

```tsx
// ✅ Correct — one branch per condition, reads top to bottom
{(() => {
  if (nvrs === null) {
    return null;
  } else if (nvrs.length === 0) {
    return <p className="py-24 text-center text-sm text-muted-foreground">No NVRs connected.</p>;
  } else {
    return <div className="grid …">{nvrs.map(…)}</div>;
  }
})()}
```

A single `cond ? <A /> : <B />` is fine — the rule starts at the third branch. Don't invent a `FooBody` component just
to escape a ternary; extract a component when a branch's content is independently large.
