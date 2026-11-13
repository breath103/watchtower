# Destructive actions must require explicit confirmation

Any control that deletes, revokes, removes or resets data the user can't trivially recreate goes through
`ConfirmDialog` (`src/ui/confirm.tsx`) before the request fires. One stray click on a trash icon must never delete
an NVR, a storage, or an API key.

```tsx
// ✅ Correct — src/ui/settings.tsx: the trash button only opens the confirm
<Button size="icon-sm" variant="ghost" aria-label={`Delete ${row.id}`} onClick={() => setDeleting(row)}>
  <Trash2 />
</Button>
<ConfirmDialog
  open={deleting !== null}
  title={`Delete storage ${deleting?.id ?? ""}?`}
  description="Cameras using it switch to the default storage. ..."
  action="Delete storage"
  onClose={() => setDeleting(null)}
  onConfirm={async () => {
    if (!deleting) return;
    await api("/api/storages/:id", "DELETE", { params: { id: deleting.id } });
    ...
  }}
/>
```

```tsx
// ❌ Wrong — single-click destruction
<Button onClick={() => void api("/api/keys/:id", "DELETE", { params: { id: key.id } }).then(reload)}>
  <Trash2 />
</Button>
```

What counts: every `DELETE` route, bulk removals, and resets that throw away non-trivial state. The description says
what happens to dependent data ("Its cameras and their thumbnail index are removed…"). Removing an unsaved tag pill
inside an edit dialog is not destructive — nothing is persisted until Save.

Never use `window.confirm`.
