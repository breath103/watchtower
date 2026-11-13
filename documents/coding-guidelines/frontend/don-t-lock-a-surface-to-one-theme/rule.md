# Don't lock a surface to one theme — use the tokens

Colors come from the tokens in `src/ui/globals.css` (`bg-background`, `bg-card`, `bg-popover`, `text-foreground`,
`text-muted-foreground`, `border`, `bg-accent`, `text-destructive`, `text-success`, `bg-brand`, `bg-live`, …). Each has
a light value in `:root` and a dark value in `.dark`. `src/index.html` pins `class="dark"` today, but the light values
are maintained — a surface built from tokens works in both; a surface built from raw colors works in one.

```tsx
// ✅ Correct — tokens only (src/ui/login.tsx)
<form className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6">
  <p className="text-sm text-destructive">{error}</p>
</form>
```

```tsx
// ❌ Wrong — hardcoded to dark; children like <Input> still read tokens and stop matching
<div className="bg-zinc-900 text-white">
  <h1 style={{ color: "#eee" }}>Sign in</h1>
  <Input />
</div>
```

Don't fork tokens locally either (re-declaring `--card` on a wrapper to "fix" descendants). If a color is missing, add
a token pair to `globals.css`.

Carve-out: chrome drawn **on top of video or a thumbnail** (`bg-black/55 text-white` captions in `grid.tsx` /
`watch.tsx`, the `bg-black` video well) is deliberately theme-independent — the backdrop is the picture, not the page.
