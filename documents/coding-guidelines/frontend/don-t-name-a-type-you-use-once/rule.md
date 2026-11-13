# Don't name a type you use once — inline it

A `type` / `interface` with exactly one reference earns nothing: it separates the shape from its only use and adds a
name to read past. Inline it at the use site.

- **Props interfaces for one component.** Don't declare `interface StorageDialogProps { … }` only to write
  `function StorageDialog(props: StorageDialogProps)`; put the object type in the signature, as
  `ConfirmDialog` and `CreateKeyDialog` do.
- **One-off aliases of an API response.** If an element type is used once, index `ApiResponse<…>` inline there.

```tsx
// ❌ Wrong — alias and interface each used exactly once
type ApiKey = ApiResponse<"/api/keys", "GET">["keys"][number];
interface CreatedKeyDialogProps { value: string | null; onClose: () => void }
function CreatedKeyDialog({ value, onClose }: CreatedKeyDialogProps) { ... }
```

```tsx
// ✅ Correct
function CreatedKeyDialog({ value, onClose }: { value: string | null; onClose: () => void }) { ... }
```

Name it the moment it has a **second** reference — `NvrListEntry` in `grid.tsx` is named because it types state and the
derived `Camera` alias.
