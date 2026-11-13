---
name: enforce-coding-guideline
description: Walk the current branch's diff against every applicable coding guideline in documents/coding-guidelines/. Lists every rule in the touched groups, runs each rule's check.sh where one exists, checks the rest by eye, APPLIES every Strong + Medium violation without asking, verifies once, and loops until nothing material is left. Use after implementation feels done but before opening / re-pushing a PR. Also owns authoring new rules.
---

# Enforce Coding Guideline

> Mechanical rule-by-rule walk of the project's coding guidelines against the current diff. The point is the
> **enumeration** — you cannot decide "this rule doesn't apply" without checking the diff against it.
>
> Not architecture — `/rethink-and-simplify` handles that. This skill is style + repo conventions, anything captured
> in `documents/coding-guidelines/<group>/<slug>/rule.md`. It loops internally and returns only when the diff passes
> every applicable guideline.

## Layout

```
documents/coding-guidelines/
  README.md            # format, groups, tooling
  search.ts            # find rules by keyword
  check-all.ts         # run every check.sh, aggregate pass/fail
  <group>/<slug>/
    rule.md            # the rule prose (always present)
    check.sh           # present ⇒ programmatic gate; absent ⇒ review by eye
```

Groups and the paths they govern:

- `backend` — everything under `src/` except `src/ui/` (routes, db, services, connectors, storage), plus `scripts/`
- `frontend` — `src/ui/`
- `sharing-code` — pure TS used on both sides (`src/client.ts`, types the UI imports from the server)

Run the tooling with the repo's tsx (never `npx`):

```bash
node_modules/.bin/tsx documents/coding-guidelines/search.ts --group backend --keywords "zod, HTTPException"
node_modules/.bin/tsx documents/coding-guidelines/check-all.ts [--group <g>]
```

## Procedure

Each pass: read diff → list every rule → check each (check.sh or by eye) → apply Strong + Medium → verify if applied →
decide whether to loop.

### 1. Read the diff — one verdict per hunk in chat

```bash
git diff origin/main...HEAD
git diff
git status --short
```

Open every changed file with the Read tool. For every hunk, emit one line:

```
<file>:<line> — <one-line description> — checked: <A>/<B>/<C>
  A intent: every changed token/literal/classname confirmed intentional (catch accidental swaps)
  B math: if a constant became a function or a range changed, every caller's arithmetic still holds
  C consistency: if a special case became general (or a name changed), every consumer of the old one is updated
```

Any hunk failing A/B/C is a Strong finding, fixed before the rule walk.

### 2. Enumerate EVERY rule

`check-all.ts` is NOT enumeration — it only runs the `check.sh` minority. For each touched group, `ls` the folder and
read the full list out loud in chat before deciding which apply:

```bash
ls documents/coding-guidelines/backend
ls documents/coding-guidelines/frontend
ls documents/coding-guidelines/sharing-code
```

State the decision for every rule you mark applicable (slug + one-line reason). `search.ts` is a supplement after the
`ls` walk, never a replacement.

### 3. Read each applicable rule.md

Front to back, including the ✅/❌ examples. "Obviously inapplicable" is where misses happen.

### 4. Checklist — one item per rule

One todo per applicable rule folder, marked `check.sh` or `manual`. This list is the audit plan.

### 5. Walk the checklist

1. **Rule has `check.sh`:** run it (`bash documents/coding-guidelines/<group>/<slug>/check.sh`). A hit your diff
   introduced is a Violation; a pre-existing hit elsewhere is out of scope (note, don't fix).
2. **No `check.sh`:** check by eye — does any changed line introduce the rule's ❌ pattern? Read the rule, don't trust
   memory. When a rule ships a "use X instead of Y" table, grep the changed files for each Y and disposition every hit.

Record per item: **Violation** (file:line + fix, ranked Strong / Medium / Minor) or **Clean**.

### 6. Apply Strong + Medium — without asking

Strong first, then Medium. Minor only if trivial. A fix that expands the PR beyond its intent → follow-up, don't apply.

### 7. Verify — only if fixes applied

`npm run typecheck`, `npm test`, re-run the relevant `check.sh` (or `check-all.ts`). If UI changed, re-verify it on the
running server per `/do-task` Step 6. Skip verify if nothing was applied.

### 8. Loop

Applied Strong/Medium → one more pass. Found nothing → stop. Hard ceiling: 2 passes.

### 9. Final report

```
Groups audited: backend, frontend
Rules walked: 18 (3 via check.sh, 15 by eye)
Pass 1 — applied:
- [frontend/<slug>] src/ui/tags.tsx:42 — <what> → <fix>   (eye)
- [backend/<slug>] src/api/routes.ts:310 — <what> → <fix>   (check.sh)
Pass 2 — clean.
Verify: typecheck clean, tests pass, check-all clean.
```

## Authoring a rule

Watchtower has no linter, so rules are prose, optionally gated by a `check.sh`.

1. Before writing a new rule, check it isn't already covered (`search.ts` + `ls` the group).
2. `documents/coding-guidelines/<group>/<slug>/rule.md`: first line `# <Title>`, then the rule, why it exists, and
   ✅/❌ examples taken from (or shaped like) watchtower's own code. Keep it short.
3. Add `check.sh` only when the rule is mechanically decidable with grep over `src/` and has no false positives today.
   It must exit non-zero and print `file:line` on violation. Run `check-all.ts` to prove the tree passes.
4. No deployment details in rules or examples (CLAUDE.md public-repo rule).

## Hard rules

- **`ls` every touched group and read the full list before deciding.** An audit report that doesn't name every rule
  folder in every touched group didn't happen.
- **Run the check.sh, don't eyeball a checkable rule.**
- **No diplomacy, no vague findings.** Every finding: file:line + rule slug + concrete fix.
- **Don't expand the PR.** Pre-existing findings outside the diff → follow-up.
- **Don't second-guess the rule.** If a rule is wrong for watchtower, say so and propose editing the rule — don't
  silently ignore it.
- **Stop in finite time.** Cap is 2 passes.
