# Never use Unicode glyphs for UI symbols — use `lucide-react` icons

`✕`, `✓`, `▾`, `▸`, `×` as literal characters in a control are a hack: they inherit the font size, don't align with
neighbouring icons, render differently per OS font, and bypass the icon set. Use `lucide-react` (`X`, `Check`,
`ChevronDown`, `ChevronRight`, `Plus`, `Trash2`, …). Inside `Button`, an icon child is sized automatically
(`[&_svg:not([class*='size-'])]:size-4`).

```tsx
// ✅ Correct
import { X } from "lucide-react";
<Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
  <X />
</Button>
```

```tsx
// ❌ Wrong — glyph as the button label
<button type="button" onClick={onClose}>✕</button>
```

Also no ASCII affordances baked into labels: `"+ Add NVR"` is an icon drawn with a character — render `<Plus />` then
the text, as the header's "Add NVR" button does. Icon-only buttons need an `aria-label`.

Carve-outs: typographic characters inside sentences and data — `…` in "Saving…", `·` separators, `–` in a time range,
`—` as an empty table cell.

`check.sh` flags a banned glyph that is the whole text of a JSX element (`>✕</`) and `text="+ …"` props under
`src/ui/`.
