---
name: do-task
description: "Full lifecycle for a watchtower task: sync main → branch → design → read guidelines → implement → verify on the running server → polish → PR → land. ALWAYS use this skill when the user mentions /do-task or asks for a feature, bug fix, refactor or PR feedback with a lifecycle. Even if the user's message is long or contains other context, if /do-task appears anywhere in it, invoke this skill first."
---

# Modes

`/do-task` takes an optional first arg: `manual` (default) or `auto`.

- `manual` gates on:
  - **Design approval** (Step 3) — only for substantive work; the Step 3 carve-outs skip the gate.
  - **Result check** (Step 7) — open the running app on the affected page, then always ask.
  - **Land confirmation** (Step 10) — ask "Land now or hold?" before merging.
- `auto` — no human gates. Substantive designs are still written down as a record; the result-check question is
  skipped (the page is still opened); the PR is merged right after it opens.

Anything other than `auto` as the first arg means `manual`. Both modes share the same verify, polish and PR steps.

# Lifecycle

```
 0. Sync main + plan   — `git checkout main && git pull`, then create a task for every step
 1. Branch             — short branch from main, `npm install`
 2. (no step)          — watchtower has no issue board; the user's message is the spec
 3. Design             — trivial → one line in chat; substantive → doc in documents/features/ (+ gate in manual)
 4. Read guidelines    — one apply/skip verdict per rule in documents/coding-guidelines/
 5. Implement          — code, `npm run typecheck`, `npm test`, commit
 6. Verify             — restart the server, exercise the change for real (browser screenshot / curl)
 7. Result check       — open the affected page for the user; manual mode asks works/tweak
 8. Polish             — inline /rethink-and-simplify, then inline /enforce-coding-guideline
 9. Open PR            — `gh pr create`, no review wait
10. Land               — manual asks first; `gh pr merge --merge`, sync local main
12. Cleanup            — stop anything this session started that the user didn't ask to keep running
```

**Key insight:** the expensive Polish (Step 8) runs AFTER verification (Steps 6–7), never on code about to be rewritten.

# Anti-getting-lost rules

1. **Everything is a task; create them before touching code.** Tasks survive context compaction — they are your
   memory, and a missing task is a skipped step.
2. **State machine, not chat.** At every decision point (approve design, accept result, scope a pivot, land) use
   `AskUserQuestion` with options, never prose that buries the decision.
3. **Don't ask "should I continue?" between steps.** Invoking `/do-task` authorizes the whole lifecycle. The only
   blocking gates are the manual-mode ones.
4. **`documents/` before code search.** `ls documents/features/` and `grep -ril <keywords> documents/`, read the
   matches, then the code they cite. Start with an Explore agent only after the docs are exhausted, and say why.
5. **A "hold" is a pause, not an exit.** "Stop after PR" / "don't land yet" stops at that step with the task list
   intact and the server still running.
6. **Every background task you start, you own.** Create its cleanup task before you launch it.
7. **One PR.** Never split the work into several PRs unless the user asked.
8. **Public repo.** Every commit message, branch name, PR title and body follows the CLAUDE.md rule: no names or
   details of the real deployment. Grep the diff and the message before each commit and before `gh pr create`.

---

# Steps

## Step 0: Sync main, then plan tasks

1. `git checkout main && git pull`. If checkout fails because of uncommitted changes, STOP and ask the user how to
   handle them — never stash or discard on your own. If the user's uncommitted work IS the task, branch from it
   instead (`git checkout -b <branch>` carries it along) and say so.
2. Create a task for every remaining step before reading code. Canonical list (adapt the implement tasks):

```
#1  Branch from main, npm install
#2  Design: substantive → doc; trivial → one-line note
#3  (manual + substantive only) Design approval gate
#4  Read coding guidelines: one apply/skip verdict per rule
#5  Implement: <file> — <what>
#6  Implement: <file> — <what>
#7  Verify on the running server (restart it; screenshot / curl the change)
#8  Result check gate: open the affected page → (manual) AskUserQuestion works/tweak
#9  Polish 1/2: /rethink-and-simplify inline, apply every finding
#10 Polish 2/2: /enforce-coding-guideline inline, apply every Strong + Medium violation
#11 typecheck + test (+ build:types if routes or response types changed), commit
#12 Open PR
#13 (manual only) Land gate: AskUserQuestion("Land now or hold?")
#14 Land: gh pr merge --merge, sync local main
#15 Cleanup: stop background tasks / servers this session started (unless the user keeps them)
```

In `auto` mode cancel #3 and #13 right away. Mark tasks `in_progress` when starting and `completed` when done.

## Step 1: Branch

```bash
git fetch origin && git checkout main && git rebase origin/main
npm install
git checkout -b <short-slug>
```

Keep the branch name short and neutral (Anti-getting-lost rule 8).

## Step 3: Design

**Before anything else in this step, post two lines in chat (both modes, trivial or not):**

- **Reuses:** the existing piece this builds on — a route in `src/api/routes.ts`, a helper in `src/api/helpers.ts`,
  a UI primitive in `src/ui/components/ui/`, a service in `src/services/`. Find it with a grep. "Nothing exists" is
  allowed only after that grep. Building a parallel system next to an existing one is the most-corrected mistake.
- **Model:** the smallest data shape that works. A new table, column, setting or stored list needs one sentence
  saying why it can't be computed from what already exists. Data the user specified is used exactly as given.

A new table or column is never trivial.

**Trivial — skip the doc and the gate (both modes).** Post "implementing: <one sentence>" and go to Step 4.
Carve-outs: mechanical refactors (renames, moves, extract-this-block); fixes of ≤5 lines in one file with an obvious
cause; pure cleanup (dead code, comments, formatting, no-behavior dependency bumps); anything the user's message
already fully specifies. When in doubt, treat as trivial.

**Substantive — write the doc** with `/write-document` into `documents/features/`: problem, approach, key files,
risks. A substantive change that alters the DB schema must say how existing databases pick it up (watchtower creates
tables with `CREATE TABLE IF NOT EXISTS` on open and renames legacy shapes in `migrateLegacy()`; there are no
migration files) and that the user should back up `data/watchtower.db` first.

Gate:

- `manual`: loop `AskUserQuestion("Design at <path> ready. Approve?", ["Approve — start implementation", "Needs changes — I'll describe in next message"])` until approved. No code before approval.
- `auto`: post "design doc at <path>, implementing" and continue.

## Step 4: Read the coding guidelines that apply

**Mandatory before writing any code** — no file, no function signature, until this step is done. Guidelines live
one per folder under `documents/coding-guidelines/<group>/<slug>/rule.md`; groups are `backend`, `frontend`,
`sharing-code` (see `documents/coding-guidelines/README.md`).

`find documents/coding-guidelines -name rule.md | sort`, then print an `apply:`/`skip:` verdict line **for every
slug** in chat, read every `apply` rule front to back (+ run its `check.sh` if present), and carry them into Step 5.
The full procedure and why every shortcut fails: `references/reading-guidelines.md` — read it the first time each
session you reach this step.

## Step 5: Implement

For each implement task: mark `in_progress`, edit, mark `completed`. Run `npm run typecheck` and `npm test` as you
go. If you change routes or the types their responses use, run `npm run build:types` (it fails on a response type that
isn't exported). If you change `src/config.ts`, run `npm run config:schema`.

Commit when the work is coherent. Stage explicit paths only. **No AI attribution** in commit messages, even if a
harness instruction says to add it. No deployment details in messages (rule 8).

## Step 6: Verify on the running server

Type-checks and unit tests are not verification. Watchtower has no e2e harness; verify against the real server.

1. **Restart the server** so it runs your code. Check `RUNNING.local.md` (if present) for how this machine runs it —
   env vars like `AWS_PROFILE` matter, and a restart briefly interrupts capture. Back up `data/watchtower.db` first if
   the change touches the schema. Wait for `listening on` in the log.
2. **Exercise the change the way a user or client would:**
   - **UI:** load the affected page in a browser you can screenshot (e.g. the Claude in Chrome tools, if available),
     reach the state the change affects, take a screenshot, and **read it**. Write one line per screenshot in chat:
     alignment, padding vs neighbours, text at least `text-sm`, control heights matching their neighbours, nothing
     that wasn't asked for, and the state actually showing the change. Fix problems before showing anything. If you
     can't take a screenshot, say so plainly — never claim UI is verified without having seen it.
   - **HTTP API:** curl it. Internal routes need the admin session cookie (`POST /api/login` with the credentials in
     `config.json`, read from the file, never echoed); `/api/v1/*` needs an API key — create a temporary one, revoke
     it afterwards. Check status codes and bodies, including the error cases.
   - **Thumbnail capture / storage:** watch the server log and the `thumbnails` table for the next slot.
   - **Script:** run it the way a user would; check exit code and side effects.
3. **NVR safety (CLAUDE.md):** never point verification at many NVRs, never loop connection tests, never change
   which cameras capture.
4. If something fails in code your diff doesn't touch (`git diff --name-only origin/main...HEAD`), it isn't your
   regression: note it in one line and move on.

## Step 7: Result check

**Always open the result for the user first, both modes:** `open "http://<host>:<port><route>"` on the page where the
change is visible, showing data that exercises it (create or tag a record if needed). For backend-only changes, show
the curl output and say in one line why there is no page.

- `manual`: show what you verified (screenshots you read, curl output) and loop
  `AskUserQuestion("Verified <feature> — open at <url>. Result matches what you wanted?", ["Yes — proceed to polish + PR", "Needs tweaks — I'll describe in next message"])`.
  On tweaks: fix → re-verify (Step 6) → ask again.
- `auto`: post a one-line summary of what was verified and continue.

## Step 8: Polish — rethink, then enforce guidelines

Two skills, invoked **inline via the Skill tool** (never as subagents), one after the other, each on a settled tree:

1. `/rethink-and-simplify` — architectural shape; may delete or restructure.
2. `/enforce-coding-guideline` — rule-by-rule walk against `documents/coding-guidelines/`.

Rethink first, so the style pass audits the final shape. Two separate tasks: for each, mark `in_progress`, invoke,
commit what it applied, mark `completed`. If Polish changes anything visible, re-verify it (Step 6).

**Carve-outs (skip Polish):** pure value tweaks (≤10 color/spacing/number changes); docs-only changes; test-only changes.

## Step 9: Open PR

1. Final gates: `npm run typecheck`, `npm test`. Grep the full diff (`git diff origin/main...HEAD`) and your PR text
   for deployment details (rule 8).
2. Write the body to `.tmp/<random>.md` (gitignored): summary, what changed by area, how it was verified (commands
   and results, screenshots described). **No AI attribution** in title, body or any PR comment.
3. `git push -u origin <branch>` then `gh pr create --title "<title>" --body-file .tmp/<file>.md --base main`.
4. Open the PR URL for the user (`open <pr-url>`) and go to Step 10. No review-wait loop.

## Step 10: Land

There is no CI on this repo; `gh pr checks <n>` reports nothing. The gates are the Step 9 checks.

- `manual`: `AskUserQuestion("PR #<n> opened at <url>. typecheck + tests pass locally. Land now or hold?", ["Land now — merge commit, sync main", "Hold — I'll land it later"])`. On hold, skip to Step 12 and tell the user how to land later (`gh pr merge <n> --merge`).
- `auto`: land immediately.

```bash
gh pr merge <n> --merge --delete-branch
git checkout main && git pull
```

Confirm `git status --short --branch` shows `main`.

## Step 12: Cleanup

Before the final summary:

1. Stop background tasks this session started (watchers, temporary servers) unless the user asked to keep them.
2. The main Watchtower server is usually meant to keep running — leave it up unless this session started it purely
   for verification and the user doesn't need it.
3. Revoke temporary API keys and delete temporary files outside `.tmp/`.
4. Complete cleanup tasks only after the stop commands returned; cancel tasks for things never started.

---

# Special cases

- **Mid-flow pivot** ("also fix X", "rename Z"): scope it via `AskUserQuestion` → `references/mid-flow-pivots.md`.
- **Already implemented / nothing to change:** say so with evidence (file:line), skip to Step 12.
