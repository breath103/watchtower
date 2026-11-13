# Watchtower

## What it is

Watchtower is a self-hosted server that connects to all of your CCTV NVRs and gives you one place to manage and
monitor them. It holds a persistent connection to each NVR, and on top of that provides a web UI for live video,
recordings and thumbnails across every camera, plus an HTTP API for other systems to consume.

## Why I made it

The vendor clients for ADT CAPS NVRs are built on ActiveX, so they only run in a legacy browser on Windows. Each NVR
is a separate login in a separate window, there is no way to see cameras from several NVRs together, and there is no
API to integrate with. Once you have more than a couple of sites, that stops being workable.

Watchtower replaces that with a single server: add each NVR once, then use any modern browser to watch every camera,
and an API key to give other applications access.

## Features

- **Camera grid** across all NVRs, with a time slider for scrubbing back through every camera's thumbnails at once.
- **Live video** in the browser. H.265 is passed through when the browser supports it and transcoded to H.264
  otherwise.
- **Recordings**: per-day recording timeline, playback, and MP4 clip export.
- **Scheduled thumbnails** to local disk or S3, configured per camera (enabled, interval, storage).
- **NVR management** in the UI: test the connection, discover cameras, edit and remove NVRs.
- **Tags** on NVRs and cameras (for example `location: HQ`), filterable through the API.
- **Logs**: captures, API requests and NVR connection events are logged as structured entries, kept for 7 days, and
  searchable in the UI.
- **Typed HTTP API** with API-key authentication. TypeScript consumers get compile-time types for every route.
- **One connection per NVR**, shared by live view, timelines and thumbnails, so concurrent viewers don't open extra
  sessions on the device.

Connectors (`src/connectors/`) and storage backends (`src/storage/`) are pluggable. ADT CAPS is the only connector
today.

## Get started

You need Node.js 24+ and `ffmpeg` on your `PATH`.

```bash
npm install
cp config.example.json config.json   # set admin.username and admin.password
npm start                            # http://127.0.0.1:10530
```

Sign in and use **Add NVR**. Thumbnail capture is off until you enable it in Settings.

Watchtower does not terminate TLS. Put it behind a reverse proxy before exposing it.

## Configuration

`config.json` holds only what is needed to start the server. Everything else (NVRs, storages, capture settings, API
keys) is stored in the database and edited in the UI.

| key | default | |
|---|---|---|
| `workDir` | `data` | database, local thumbnails, clip cache, logs |
| `host` | `127.0.0.1` | interface to bind |
| `port` | `10530` | HTTP port |
| `admin.username` / `admin.password` | required | the one UI login (password ≥ 8 characters) |

Use `--config <path>` to load a different file.

## Using the API

- The web UI signs in with the admin account.
- Other apps call `/api/v1/*` with `Authorization: Bearer <key>`. Create keys in Settings → API keys. Each key is
  shown once.

TypeScript projects can install Watchtower as a dependency and get the route types (types only, no runtime code):

```jsonc
"dependencies": { "watchtower": "github:<owner>/watchtower" }
```

```ts
import type { WatchtowerApi } from "watchtower/api";

const { nvrs } = await watchtower("/api/v1/cameras", "GET");
// nvrs: { id, name, tags, cameras: { id, name, tags, thumbnail: { every } | null }[] }[]

await watchtower("/api/v1/cameras", "GET", {
  query: { filter: { nvrs: { tags: { location: ["HQ", "Lab"] } } } },
});
```

A wrong path, a missing param or a wrong field type is a compile error. Keep `skipLibCheck` on.

<details>
<summary>The <code>watchtower()</code> helper used above</summary>

```ts
type Endpoint<P extends keyof WatchtowerApi, M extends keyof WatchtowerApi[P]> = WatchtowerApi[P][M];
type Input<E> = (E extends { params: infer T } ? ([T] extends [never] ? unknown : { params: T }) : unknown) &
  (E extends { query: infer T } ? ([T] extends [never] ? unknown : { query: T }) : unknown) &
  (E extends { body: infer T } ? ([T] extends [never] ? unknown : { body: T }) : unknown);

async function watchtower<P extends keyof WatchtowerApi & string, M extends keyof WatchtowerApi[P] & string>(
  path: P,
  method: M,
  input: Input<Endpoint<P, M>> = {} as Input<Endpoint<P, M>>
): Promise<Endpoint<P, M> extends { response: infer R } ? R : never> {
  const { params, query, body } = input as { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown };
  let url = BASE_URL + path.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params?.[key] ?? ""));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  if (search.size > 0) url += `?${search}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}`);
  return response.json();
}
```

Over plain HTTP, the filter is URL-encoded JSON: `GET /api/v1/cameras?filter={"nvrs":{"tags":{"location":["HQ"]}}}`.
Within a tag type any listed value matches; every listed type must match.

</details>

## Development

```bash
npm run typecheck
npm test
npm run build:ui
```

`scripts/probe-*.ts` connect to real NVRs. Read a script before running it.
