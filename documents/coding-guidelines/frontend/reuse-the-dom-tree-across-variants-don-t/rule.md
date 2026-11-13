# Reuse the DOM tree across variants — don't branch into separate subtrees

When a component has display modes (live/recording/idle, editing/viewing, with/without a value), don't return two
whole JSX trees. Keep one layout and conditionally render the parts that differ, so React keeps the DOM nodes.

Separate subtrees remount everything (losing focus, scroll and the `<video>` element's state), duplicate shared markup,
and every later change has to be made twice.

```tsx
// ✅ Correct — src/ui/watch.tsx keeps one <video>; playing only toggles visibility and the overlays
<video ref={videoRef} className={cn("absolute inset-0 size-full object-contain", !playing && "invisible")} … />
{!playing && thumb !== null ? <img … /> : null}
```

```tsx
// ❌ Wrong — two trees; switching modes unmounts the <video> and drops its MediaSource
if (playing) return <div className="relative …"><video ref={videoRef} … /></div>;
return <div className="relative …"><img … /></div>;
```

If you catch yourself writing `if (state) return <A />; return <B />;` at the top of a render, check whether A and B
are really different shapes or the same shape with different parts.
