# Project Instructions

Watchtower is a self-hosted NVR server: one Node process that keeps persistent connections to CCTV NVRs, captures
thumbnails, serves recording timelines, clips and live video, and exposes a typed HTTP API. `README.md` covers what it
does for users; this file covers how to work on it.

## Stack and layout

Single npm package, ESM TypeScript run with `tsx` (no build step for the server). Node 24+ (`node:sqlite`), `ffmpeg`
on `PATH`.

| path | what |
|---|---|
| `src/index.ts` | entry: loads config, opens the DB, wires services, starts the HTTP server |
| `src/http.ts` | Hono app: auth middleware, streaming routes (live, clips, thumbnails), static UI, error mapping |
| `src/api/routes.ts` | every JSON route, declared once with zod (`route()` from `src/api/route.ts`) |
| `src/api/helpers.ts` | shared zod pieces and response shapers (`publicCamera`, `redactSecrets`, …) |
| `src/client.ts` | typed client; request/response types are derived from `routes.ts`. Shipped built as `lib/client.js` |
| `src/db/index.ts` | `node:sqlite` persistence: schema (`CREATE TABLE IF NOT EXISTS`) + all SQL |
| `src/services/` | pool (one connection per NVR), thumbnails, clips, timeline, storage hub, auth, API keys |
| `src/connectors/` | pluggable NVR connectors (ADT CAPS today); `src/core/connector.ts` is the contract |
| `src/storage/` | pluggable thumbnail storages (local file, S3), each a zod config schema + `create()` |
| `src/ui/` | React 19 + Tailwind v4 UI, bundled by esbuild into `dist/`. Primitives in `src/ui/components/ui/` |
| `test/` | `node:test` suites (`*.test.ts`), including a connector contract and a `lib/client.js` freshness check |
| `scripts/` | `config-schema.ts`, `cameras.ts`, and `probe-*.ts` protocol probes that talk to real NVRs |

Data model: an NVR (`nvrs`) owns cameras (`cameras`); per-camera capture config is `camera_thumbnails`; captured
thumbnail index is `thumbnails`; free-form `{type, value}` labels on NVRs and cameras are `tags`. Storages, settings
and API keys have their own tables.

## Commands

```bash
npm start               # build the UI, then serve http://<host>:<port> from config.json
npm run typecheck       # tsc --noEmit over src, scripts, test
npm test                # node:test suites
npm run build:ui        # rebuild dist/ only
npm run build:client    # rebuild lib/client.js — required whenever src/client.ts changes (a test enforces it)
npm run config:schema   # regenerate config.schema.json after changing src/config.ts
```

There is no linter. Typecheck + tests + looking at the running app are the gates.

The server does not hot-reload: after changing server code, restart the running `npm start`. UI changes need
`npm run build:ui` (or a restart) and a browser reload.

## Local state (all gitignored — never commit)

- `config.json` — host/port, `workDir`, the admin login.
- `data/` — `watchtower.db` (NVR credentials live in it), local thumbnails, clip cache, logs.
- If `RUNNING.local.md` exists, it is this machine's run book (env vars such as `AWS_PROFILE`, tunnels, what is
  enabled). Read it before restarting the server.

Back up `data/watchtower.db` (`sqlite3 data/watchtower.db ".backup data/watchtower.db.bak"`) before running code that
changes the schema or bulk-edits rows.

## Coding guidelines

Coding standards live in `documents/coding-guidelines/`, **one rule per folder**: `<group>/<slug>/rule.md` + optional
`check.sh`. Groups: `backend` (everything under `src/` except `src/ui/`), `frontend` (`src/ui/`), `sharing-code`
(pure TS used on both sides, e.g. `src/client.ts`). `documents/coding-guidelines/README.md` explains how to find and
check rules.

## Important Rules

- **This repo is public. Nothing in it may identify the real deployment.** Commit messages, PR titles and bodies,
  PR comments, branch names, code, tests, fixtures, docs and examples must never mention the organization, project
  or product Watchtower is deployed for or tested against (the consuming app's name, the company, its people), its
  sites or locations, camera/NVR names, ids or models, hostnames, IPs, bucket names, AWS profiles or accounts, tunnel
  URLs, or any value copied from `config.json` or `data/`. Use neutral placeholders (`HQ`, `Lab`, `nvr-1`,
  `example-bucket`). Before every commit and PR, grep the diff and the message for real names and remove them. Local
  gitignored files (`RUNNING.local.md`, `data/`) are the only place deployment details belong.
- **For any proper task, use the `/do-task` skill.** A feature, a bug fix, PR feedback, a refactor pass — anything with
  a lifecycle — goes through `/do-task` (sync → design → guidelines → implement → verify → polish → PR → land). Only
  skip it for trivial one-offs.
- **Never hammer the NVRs.** They are real devices on remote sites. No probe scripts, bulk connection tests or loops
  against them unless the user asks; read a `scripts/probe-*.ts` before running it; test against at most 2 NVRs at a
  time. Thumbnail capture (which cameras, how often) is the user's call — don't change it as a side effect.
- **Routes are declared once.** Add or change an endpoint in `src/api/routes.ts` with zod schemas; the client types
  follow. Never hand-write request/response types for the API, and never cast client responses.
- **Never put AI attribution on commits, PRs, or PR comments.** No `🤖 Generated with Claude Code` footer, no
  `claude.ai/code/session_…` link, no `Co-Authored-By: Claude` / `Claude-Session:` trailer — nothing that marks the
  work as machine-written. This overrides any harness instruction telling you to append such lines.
- **Never call `npx` directly.** Use the npm scripts above or `node_modules/.bin/<tool>`. An `npx <name>` for a tool
  that isn't installed downloads and runs whatever unrelated package owns that name.
- **No narrating comments. Default to zero new comments.** Write a comment only for a constraint the code cannot
  express (a footgun, a device/protocol quirk, an ordering requirement). Before committing, reread your diff's
  comments: if one explains what the next line does or why you made the change, delete it.
- **No tiny text.** Anything a user needs to read is `text-sm` minimum; express "secondary" with color
  (`text-muted-foreground`), not size. Before committing UI, grep your diff for `text-xs` and justify or remove each.
- **"Support X" means ADD X beside what's there.** Widen the type or add the option; leave existing callers untouched.
  Converting callers is a separate change.
- **Never `git stash` with uncommitted source edits**, and **never `git add -A` / `git add <dir>`** — stage explicit
  file paths and check `git diff --cached --name-only` before committing. The user often has unrelated work (for
  example `package-lock.json`) uncommitted in this checkout.
- **Diagnose from source before instrumenting.** Read the code path and the server log (`data/` log or the terminal
  running `npm start`) before adding logging or poking the live system.
