# Mutually exclusive `if` blocks chain with `else if` — and end with an explicit `else`

A run of independent `if` blocks testing the **same** value reads as if several could fire; the reader has to check
each one returns to see they're exclusive. Chain them with `else if` so the exclusivity is structural, and make the
fallback a terminal `else`.

```tsx
// ✅ Correct — src/ui/watch.tsx TimelineBar onKeyDown
if (event.key === "ArrowLeft") onSeek(Math.max(start, at - delta));
else if (event.key === "ArrowRight") onSeek(Math.min(end, at + delta));
else if (event.key === "Enter" || event.key === " ") onPlay(at);
else return;
event.preventDefault();
```

```tsx
// ❌ Wrong — parallel ifs on one discriminant
if (event.key === "Enter") { commit(); return; }
if (event.key === "Escape") { cancel(); return; }
```

If the discriminant is a string-literal union, use `switch` instead
(`frontend/always-use-switch-for-discriminated-unions`). Guard clauses on *different* conditions
(`if (!video || !source) return;`) stay flat.
