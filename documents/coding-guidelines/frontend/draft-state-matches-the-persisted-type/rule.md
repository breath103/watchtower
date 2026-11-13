# Draft state matches the persisted type

When you pull a value into `useState` to edit it, keep the draft in the same type the server stores. Don't stringify a
number because an `<Input>` displays strings, and don't `JSON.stringify` an object into a text field. Convert at the
render boundary.

```tsx
// ✅ Correct — frequencyS stays a number; the Select converts at the edge (src/ui/nvr-edit.tsx)
<Select value={String(camera.capture.frequencyS)} onValueChange={value => setCapture(camera, { frequencyS: Number(value) })}>
```

```tsx
// ❌ Wrong — every save now needs Number(...), and "abc" is a representable draft
const [frequency, setFrequency] = useState(String(config.frequencyS));
```

If the field may legitimately be empty, use `number | null` — not `0` or `""` as a sentinel.

Carve-out: `SchemaFields` / `FormValues` in `src/ui/schema-form.tsx` render forms from an arbitrary JSON Schema, so the
draft is deliberately `Record<string, string>` and `formPayload` converts per the schema's `type` on submit. Use it
for connector/storage config; don't copy the string-draft pattern into hand-written forms.
