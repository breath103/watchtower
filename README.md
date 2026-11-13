# Watchtower

If you've ever had to use the official ADT CAPS clients, you know. ActiveX. Seriously? It's 2026. And when your
cameras are spread over a bunch of NVRs at different sites, each one is its own separate login and its own separate
window. There's no API either.

So I built Watchtower.

It's one small server you run yourself. You connect all your NVRs to it once, and from then on it's the single place
where every camera lives: one web page to watch them, one API for your other apps to read from. No plugins, no
ActiveX, no logging in to each NVR.

## What it does

- **Every camera on one screen.** A grid of all cameras across all NVRs, with a time slider to scrub back through
  thumbnails for all of them at once.
- **Live video in a normal browser.** Click a camera to watch it live. H.265 plays directly where the browser can, and
  is converted to H.264 where it can't.
- **Recordings.** See the recording timeline for any day, play back any part of it, and save a clip as MP4.
- **Thumbnails on a schedule.** Grab a snapshot from each camera every N seconds and store it on local disk or S3.
  On or off, interval and storage are set per camera.
- **Add NVRs from the UI.** Enter the address and login, test the connection, and the cameras are discovered for you.
- **Tags.** Label NVRs and cameras (`location: HQ`), and filter by them in the API.
- **Logs page.** Everything the server does (each capture, each request, each NVR reconnect) is logged, kept for 7
  days, and searchable from the browser.
- **A typed HTTP API.** Other apps read the camera list with an API key, and TypeScript projects get full types for
  every route.
- **Gentle on the NVRs.** One connection per NVR, shared by everything, so ten people watching doesn't mean ten
  logins.

Connectors (`src/connectors/`) and storage backends (`src/storage/`) are pluggable. ADT CAPS is the only connector
today.

## Get started

You need Node.js 24+ and `ffmpeg` on your `PATH`.

```bash
npm install
cp config.example.json config.json   # set admin.username and admin.password
npm start                            # http://127.0.0.1:10530
```

Sign in, click **Add NVR**, and you're done. Thumbnail capture stays off until you turn it on in Settings.

Watchtower doesn't do HTTPS itself. Put it behind a reverse proxy before you expose it to the internet.

## Configuration

`config.json` holds only what's needed to boot. Everything else (NVRs, storages, capture settings, API keys) is stored
in the database and edited in the UI.

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

`scripts/probe-*.ts` talk to real NVRs. Read one before you run it.
