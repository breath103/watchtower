# Never use `""` to mean "no value" — use `null`

An empty string is a value (the user cleared a field). Absence is `null`. Conflating them makes the type lie and
pushes every reader into truthiness checks.

```tsx
// ✅ Correct — null means "nothing selected / not loaded"
const [editing, setEditing] = useState<string | null>(null);
const [created, setCreated] = useState<string | null>(null);
<EditNvrDialog nvrId={editing} … />
```

```tsx
// ❌ Wrong — "" as a sentinel
const [busy, setBusy] = useState("");                    // "" = idle
const [message, setMessage] = useState({ kind: "", text: "" }); // kind "" = no message
```

Prefer `null` (or a `{ kind: "idle" }` union member) for "nothing". A controlled `<Input>` still needs a string, so
convert at the edge: `value={draft ?? ""}`.

Exceptions forced by an API: Radix `Select` can't take `""` as an item value (see the `DEFAULT_STORAGE` sentinel in
`nvr-edit.tsx`), and `URLSearchParams` has no null — `useSearchParam` returns `""` for a missing param. Convert to
`null` right after reading if the value travels further.
