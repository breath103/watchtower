# Every async user action gets visible loading state — including icon buttons

A button that fires a request must show it is working and refuse a second click until the request settles. Without
that, a slow NVR or network leaves the button looking idle; the user clicks again and the action runs twice (two NVRs
saved, two keys created).

Watchtower's pattern is a local busy flag that disables the button and changes its label, cleared in `finally`:

```tsx
// ✅ Correct — src/ui/nvr-edit.tsx
const [saving, setSaving] = useState(false);
const save = async (): Promise<void> => {
  setSaving(true);
  try {
    await api("/api/nvrs/:id", "PUT", { ... });
  } finally {
    setSaving(false);
  }
};
<Button disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
```

Icon-only buttons need it too: disable while busy and swap the icon for lucide's `Loader2` with `animate-spin`.

```tsx
// ❌ Wrong — no feedback, double click sends two requests
<Button size="icon-sm" variant="ghost" onClick={() => void api("/api/keys/:id", "DELETE", { params: { id } }).then(reload)}>
  <Trash2 />
</Button>
```

When a dialog runs several actions (Test / Discover / Save in `connect.tsx`), one `busy: string` label is fine — but
disable every action while any one is running.
