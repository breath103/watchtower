# User-facing pages live in the React app — the backend never renders HTML

Anything a person looks at in a browser is a React page under `src/ui/`. The Hono server only serves the static shell
(`src/index.html`) and the built bundle (`/app.js`, `/app.css`); it never builds HTML strings in a handler.

Adding a page:
1. Add the route to `ROUTES` in `src/ui/router.ts` and render it from `App` in `src/ui/app.tsx`.
2. Add its path to the page list in `createApp` (`for (const route of ["/", "/settings"]) app.get(route, page)`) so a
   reload or deep link serves the shell instead of a 404.

The page talks to the server through typed `route()` JSON endpoints called with `api(...)` — not a native
`<form method="post">` to a handler.

```ts
// ✅ Correct — server serves the shell; the page is React
for (const route of ["/", "/settings", "/recordings"]) app.get(route, page);
```

```ts
// ❌ Wrong — HTML assembled in a handler: no session handling, no design system, no router
app.get("/recordings", c => c.html(`<ul>${rows.map(r => `<li>${r.camera}</li>`).join("")}</ul>`));
```

Binary/streaming responses (MP4, JPEG, fMP4 live streams) are not pages and stay as raw Hono handlers in `src/http.ts`.
