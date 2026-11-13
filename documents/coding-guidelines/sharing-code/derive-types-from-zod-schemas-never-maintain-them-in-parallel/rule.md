# Derive types from zod schemas — never maintain them in parallel

When a shape has a zod schema (a route body, a jsonb-ish blob, a connector/storage config, `config.json`), the
schema is the single source of truth. Derive the type with `z.infer` / `z.output`; never hand-write an `interface`
with the same fields. Two declarations drift, and the drift only shows when the validator accepts something the type
doesn't (or the reverse).

```ts
// ✅ Correct — schema and type ship from one module (src/api/helpers.ts, src/config.ts)
export const camerasFilter = z.strictObject({ nvrs: entityFilter.optional(), cameras: entityFilter.optional() });
export type CamerasFilter = z.infer<typeof camerasFilter>;

type AppConfig = Omit<z.output<typeof configSchema>, "$schema">;
```

```ts
// ❌ Wrong — the same shape declared beside its schema, again in the UI
export const tagSchema = z.object({ type: z.string().trim().min(1), value: z.string().trim().min(1) });
export interface Tag { type: string; value: string }   // server
export interface Tag { type: string; value: string }   // src/ui/…
```

Fix shape: `export type Tag = z.infer<typeof tagSchema>` next to the schema (`src/core/types.ts`), and every other
file — server or UI — does `import type { Tag } from "…"`. `import type` is erased by esbuild, so the UI bundle doesn't pull
in server code; the UI already does this for `JsonObjectSchema` (`src/ui/schema-form.tsx`).

For API responses, the UI doesn't need a declared type at all: `ApiResponse<"/api/nvrs", "GET">` (from
`src/ui/api.ts`) is derived from the handler's return value.

When zod is the wrong tool: sqlite row shapes inside `src/db/index.ts` (`NvrRow`, `CameraRow`) are private to that
file and mapped to records there; they don't cross a boundary, so a plain interface is fine.

If one route uses a one-off shape, keep it inline in the `route()` call (`backend/inline-single-use-schemas-and-variables`);
promote to a named schema + derived type when a second consumer appears.
