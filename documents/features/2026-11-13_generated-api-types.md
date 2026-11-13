# Generated API types instead of a shipped client

## Summary

Watchtower's routes are declared once in `src/api/routes.ts`; the TypeScript compiler generates `.d.ts` declarations
from them (`npm run build:types` → `dist/types/`). A consumer imports only the type `WatchtowerApi` and calls the API
through its own small generic client. Nothing about the API is hand-maintained or committed as a build output, and a
consumer never compiles the server.

## Before

- `lib/client.js`: a hand-run esbuild bundle of `src/client.ts`, committed, kept fresh by a test.
- Its types came from `"types": "./src/client.ts"`, so a consumer's compiler type-checked watchtower's server source
  (routes, services, database, connectors) and needed every server dependency's types to type one call.

## After

| piece | where |
|---|---|
| routes, declared once with zod | `src/api/routes.ts` (`apiRoutes`, `WatchtowerApi = ApiOf<ReturnType<typeof apiRoutes>>`) |
| declaration build | `tsconfig.types.json` + `npm run build:types` (`tsc --emitDeclarationOnly`) → `dist/types/` (gitignored) |
| build on install | `"prepare": "npm run build:types"` — npm runs it when installing watchtower as a git dependency |
| package surface | `exports["./api"].types` → `dist/types/api/routes.d.ts`; `"files": ["dist/types"]` (no source, no JS) |
| watchtower's own UI client | `src/ui/api.ts` — a generic request function over `WatchtowerApi`, same shape a consumer writes |

Consumer:

```ts
import type { WatchtowerApi } from "watchtower/api";
// small generic client over WatchtowerApi — see README "Typed client"
```

## Risks

- Consumers that imported `watchtower/client` (`createWatchtowerClient`) must switch to their own client over
  `WatchtowerApi`. The HTTP API itself is unchanged.
- Generated declarations reference `zod`/`hono` types, which install as watchtower's dependencies; consumers should
  keep `skipLibCheck` on, as is standard.
