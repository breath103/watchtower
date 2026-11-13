# Coding guidelines

Watchtower's style and convention rules, one rule per folder. Every rule describes code that exists in this repo.
Its examples come from `src/`, or are written to look like it, and it names only APIs, files and primitives that
exist here. Watchtower has no linter, so most rules are checked by reading the code. A few also have a grep-based
`check.sh`.

## Layout

```
documents/coding-guidelines/
  README.md
  _lib.ts              # shared helper: list rule folders
  search.ts            # find rules by keyword
  check-all.ts         # run every check.sh, aggregate pass/fail
  <group>/<slug>/
    rule.md            # the rule (always present)
    check.sh           # optional programmatic gate
```

`rule.md` has no frontmatter. Its first line is `# <Title>`, followed by the rule, why it exists, and ✅ / ❌
examples. Rules are short.
Examples show the pattern, not where it occurs today: existing code that breaks a rule is not a license to copy it.

`check.sh` is added only when the rule can be decided with grep over the repo **and** the current tree passes. It
`cd`s to the repo root, prints `file:line` for each violation, and exits non-zero.

## Groups

| Group | Governs |
|---|---|
| `backend` | everything under `src/` except `src/ui/`: routes (`src/api/`), `src/http.ts`, `src/db/`, `src/services/`, `src/connectors/`, `src/storage/`, `src/config.ts`. Also `scripts/` and `test/`. |
| `frontend` | `src/ui/`: React 19 pages, `src/ui/components/ui/` primitives, `globals.css` |
| `sharing-code` | TypeScript used on both sides: `WatchtowerApi` and the UI client (`src/ui/api.ts`), schemas and types the UI imports from the server |

Some rules exist in both `backend` and `frontend` under the same slug (switch on unions, redundant annotations,
`""` vs `null`). Each copy uses examples from its own side.

## Finding rules

Use the repo's own tsx. Don't use `npx`.

```bash
node_modules/.bin/tsx documents/coding-guidelines/search.ts --group backend --keywords "zod, HTTPException"
node_modules/.bin/tsx documents/coding-guidelines/search.ts --keywords "Dialog"        # all groups
node_modules/.bin/tsx documents/coding-guidelines/search.ts --group frontend           # list a whole group
```

Keywords are comma-separated and matched case-insensitively against each rule's text, with OR between them. Results
are ranked by how many keywords hit. Each result is tagged `[check]` if it has a `check.sh`, or `[manual]` if it's
reviewed by eye.

Search is a supplement. To audit a change, `ls` each touched group and read the whole list:

```bash
ls documents/coding-guidelines/backend documents/coding-guidelines/frontend documents/coding-guidelines/sharing-code
```

## Running the checks

```bash
node_modules/.bin/tsx documents/coding-guidelines/check-all.ts                  # every check.sh
node_modules/.bin/tsx documents/coding-guidelines/check-all.ts --group frontend
bash documents/coding-guidelines/frontend/never-use-unicode-glyphs-for-ui-symbols-use-icons/check.sh
```

`check-all.ts` reports `Passed: N, Failed: M`. It names only the failures, each with its output indented, and exits
non-zero if any check failed. Both scripts work from any working directory. From the repo root they can also run
directly (`./documents/coding-guidelines/check-all.ts`): the shebang is `node --import tsx`, which resolves `tsx`
from `./node_modules`.

The checks don't replace `npm run typecheck` and `npm test`. Run those too.

## Adding a rule

1. Use `search.ts` and `ls` the group to make sure the rule isn't already covered.
2. Create `<group>/<slug>/rule.md` with a kebab-case slug. Use watchtower's own code for the examples.
3. Add a `check.sh` only if the rule is grep-decidable with no false positives today. Then run `check-all.ts` to show
   the tree passes.
4. Leave deployment details out of rules and examples. This is a public repo: use neutral placeholders like `nvr-1`,
   `HQ` and `example-bucket`.
