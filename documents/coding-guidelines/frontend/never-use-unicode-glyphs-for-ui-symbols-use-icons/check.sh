#!/usr/bin/env bash
# Rule: no Unicode glyphs (✕ ✗ ✓ ⌃ ⌄ ▾ ▴ ◂ ▸ ×) as the visible label of a JSX element,
# and no "+ " affordance glyph baked into a text prop. Use a lucide-react icon.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

hits="$(grep -rnE '>[[:space:]]*(✕|✗|✓|⌃|⌄|▾|▴|◂|▸|×)[[:space:]]*</' --include='*.tsx' src/ui || true)"
label_hits="$(grep -rnE '(text|label|title)="\+ ' --include='*.tsx' src/ui || true)"

if [[ -n "$hits$label_hits" ]]; then
  [[ -n "$hits" ]] && echo "$hits"
  [[ -n "$label_hits" ]] && echo "$label_hits"
  echo "→ Replace the glyph with a lucide-react icon (e.g. <X />, <Plus /> before the label text)."
  exit 1
fi
