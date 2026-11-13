# Watchtower

A small self-hosted server that owns your CCTV NVRs: it keeps the connections, captures thumbnails, shows recording
timelines, plays and saves recorded clips, and streams live video to the browser. Other systems read the camera list
over an API-key-protected HTTP API, using a fully typed TypeScript client.

- **Camera grid** with a time slider: scrub back through thumbnails for every camera at once.
- **Single-camera view**: live video, recordings timeline, progressive clip playback, save clip as MP4.
- **Thumbnails** on epoch-aligned slots (`<camera>/thumbnails/<slot>.jpeg`, slot = `floor(t / every) * every`),
  written to local disk or S3, configurable per camera (on/off, storage, interval).
- **NVR management** from the UI: connect wizard (test connection, discover cameras), edit, delete.
- **One admin login** for the web UI; **API keys** for other systems.

Supported NVRs: the ADT CAPS protocol used by STL NVA-series recorders. Connectors are pluggable
(`src/connectors/`), as are storage backends (`src/storage/`: local file, S3).

## Requirements

- Node.js 24+ (uses the built-in `node:sqlite`)
- `ffmpeg` on `PATH`

## Quick start

```bash
npm install
cp config.example.json config.json   # then set admin.username / admin.password
npm start                            # builds the UI, serves http://127.0.0.1:10530
```

Sign in with the admin account, then **Add NVR**. Thumbnail capture is **off** until you turn it on in Settings.

## Configuration

`config.json` (gitignored), validated against `config.schema.json` (`npm run config:schema` regenerates it). Pass
`--config <path>` to use another file. Paths resolve relative to the config file.

| key | default | |
|---|---|---|
| `workDir` | `data` | sqlite database, local thumbnails, clip cache |
| `host` | `127.0.0.1` | interface to bind |
| `port` | `10530` | HTTP port |
| `admin.username` / `admin.password` | required | the one account that can sign in to the UI (password ≥ 8 chars) |

Everything else (NVRs, storages, per-camera capture, API keys) lives in the sqlite database and is edited in the UI.

## Authentication

- **UI and internal API** (`/api/*`): sign in with the admin account. Signing in sets a signed, HttpOnly session
  cookie for 30 days. Changing the admin credentials signs every session out.
- **External API** (`/api/v1/*`): `Authorization: Bearer <key>`. Create keys in Settings → API keys; a key is shown
  once and only its hash is stored.

Watchtower has no TLS of its own. Put it behind a reverse proxy that terminates HTTPS before exposing it.

## Typed client

Routes are declared once (`src/api/routes.ts`: zod schemas for input, the handler's return type for output), and
the client derives every request and response type from them, so nothing is typed by hand.

```ts
import { createWatchtowerClient } from "watchtower/client";

const watchtower = createWatchtowerClient({
  baseUrl: "https://watchtower.example.com",
  apiKey: process.env.WATCHTOWER_API_KEY,
  timeoutMs: 5000,
});

const { nvrs } = await watchtower("/api/v1/cameras", "GET");
// nvrs: { id, name, cameras: { id, name, thumbnail: { every } | null }[] }[]
```

A wrong path, a missing param, or a wrong field type is a compile error. Errors throw `WatchtowerError`
(`status`, `code`, `message`).

## How it talks to NVRs

- **One persistent connection per NVR** carries login, heartbeat, timeline queries, live view, and thumbnail grabs.
  Live channels are refcounted subscriptions on it: two viewers of a channel share one subscription, and the
  channel is stopped only when the last one leaves.
- **Clip playback** uses a short-lived second connection per fetch, so a clip burst never competes with live video.
- **Timeline** is the NVR's per-minute recording map, cached per NVR and date (past dates are immutable).
- **Live and clips** are streamed to the browser as fragmented MP4 over HTTP and played with MSE. H.265 is served
  as-is when the browser can decode it, otherwise transcoded to H.264. Completed clips are cached locally for an hour.

## Development

```bash
npm run typecheck
npm test
npm run build:ui
```

`scripts/probe-*.ts` are protocol probes against a real NVR (`--cameras <file>`); read them before running one.
