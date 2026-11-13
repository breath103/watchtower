# Always use `switch` for discriminated unions

When handling a discriminated union (or a string-literal union), `switch` on the discriminant. Don't use `if`/`else
if` chains or nested ternaries: a `switch` whose cases each `return` is checked for exhaustiveness by `tsc` (a missing
case makes the function's return type fail), so adding a variant to the union points you at every place to update.

```ts
// ✅ Correct — exhaustive; adding a status breaks the build until it's handled
function statusLabel(job: ClipJob): string {
  switch (job.status) {
    case "queued":  return "Queued";
    case "running": return `Saving ${Math.round(job.progress * 100)}%`;
    case "ready":   return "Ready";
    case "failed":  return job.error ?? "Failed";
  }
}
```

```ts
// ❌ Wrong — a new status silently falls into the last branch
const label = job.status === "ready" ? "Ready" : job.status === "failed" ? "Failed" : "Working";
```

Stacked `case` labels are fine when two variants share an output. A single boolean `cond ? a : b` is fine — the rule
starts at the second `?`. Run `npm run typecheck` to get the exhaustiveness check.
