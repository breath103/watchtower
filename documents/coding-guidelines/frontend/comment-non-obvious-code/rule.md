# Comment non-obvious code

If a line isn't self-explanatory — a browser quirk workaround, a Radix/MSE constraint, a timing value, a sentinel —
add a short comment saying **why** it's there.

```ts
// ✅ Correct — the constraint is invisible from the code alone (src/ui/nvr-edit.tsx)
// Radix Select forbids empty-string item values, so the "default storage"
// option uses a sentinel that maps back to storageId === null.
const DEFAULT_STORAGE = "__default__";

// A slot's image lands a few seconds after its boundary (grab + decode +
// upload), so live waits this long before moving to a new slot.
const LIVE_DELAY_MS = 10_000;
```

Don't comment what the code already says (`// set the name` above `setName(...)`). Where the comment goes is
`frontend/place-comments-on-the-line-they-explain`.
