#!/usr/bin/env bash
# Rule: only src/db/ talks to node:sqlite. Everything else goes through Database methods.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

hits="$(grep -rnE 'node:sqlite|DatabaseSync|\.prepare\(' --include='*.ts' --include='*.tsx' src scripts test \
  | grep -v '^src/db/' || true)"

if [[ -n "$hits" ]]; then
  echo "$hits"
  echo "→ SQL outside src/db/. Add a method to Database (src/db/index.ts) and call it instead."
  exit 1
fi
