# Format UI dates through `src/ui/time.ts`

Every user-facing date or time goes through the helpers in `src/ui/time.ts` — `clock(ms)`, `day(ms)`, `stamp(ms)`,
`ago(value, isSeconds)`, `timeTicks(start, end)` — not `toLocale*String(...)` or `new Intl.DateTimeFormat(...)` at the
call site. One module means one 24-hour clock, one date style, and a format change is a one-line edit.

```tsx
// ✅ Correct
import { ago, stamp } from "./time.js";
<span className="tabular-nums">{stamp(at)}</span>
<TableCell>{ago(camera.state.lastTs, true)}</TableCell>
```

```tsx
// ❌ Wrong — a private formatter with its own style
new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
```

Need a format that doesn't exist yet? Add a helper to `time.ts` (and a case to `test/time.test.ts` if it has logic).
Inputs are UTC epoch ms (`backend/always-parse-timestamps-with-new-date-never-slice`); the helpers render in the
browser's local zone.
