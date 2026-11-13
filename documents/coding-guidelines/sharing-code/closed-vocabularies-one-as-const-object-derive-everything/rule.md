# Closed vocabularies: one `as const` object — derive everything else

When a closed set of identifiers carries per-member data (a path, a label, a config value), declare ONE `as const`
object keyed by the identifiers. The union type, the key list, and every lookup derive from it. Never keep a parallel
tuple + `Record`: two declarations of one vocabulary drift when a member is added to only one.

```ts
// ✅ Correct — src/ui/router.ts
export const ROUTES = { cameras: "/", settings: "/settings" } as const;
export type Route = keyof typeof ROUTES;

ROUTES[route];                       // the lookup
Object.keys(ROUTES) as Route[];      // the list, where one is needed
```

```ts
// ❌ Wrong — the same vocabulary declared twice
export const ROUTE_IDS = ["cameras", "settings"] as const;
export type Route = (typeof ROUTE_IDS)[number];
export const ROUTE_PATHS: Record<Route, string> = { cameras: "/", settings: "/settings" };
```

A bare `as const` tuple is fine while members carry no data. A list that adds presentation for a *subset or ordering*
of the vocabulary (`NAV` in `src/ui/app.tsx`) should be typed off the derived union (`route: Route`) so the compiler
still checks it.

Bundling boundary: when the ids are owned by server code and the data is UI copy, keep the vocabulary on the owning
side and type the UI table as `Record<Member, X>` off an `import type`d union — esbuild erases the type import, and the
compiler still enforces that every member has an entry.
