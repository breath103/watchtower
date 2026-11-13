# Extract clusters of `useState` / `useEffect` / `useRef` into named hooks

When several hooks together implement one feature (debouncing, a polling clock, pointer scrubbing, a video player
binding), move that group into a named custom hook. The component body should read: call hooks → compute a few
values → return JSX.

Signals a cluster is ready to extract:
- Two or more of `useState` / `useEffect` / `useRef` / `useCallback` touch the same feature and nothing else.
- The effect closes over the same state, setter and refs.
- You can't name the component's concern in one phrase because it's doing two things.

```tsx
// ✅ Correct — src/ui/grid.tsx: debouncing is named, the grid just uses it
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const shown = useDebounced(t, SCRUB_DEBOUNCE_MS);
```

```tsx
// ❌ Wrong — the same mechanism inlined into a 200-line component
const [shown, setShown] = useState(t);
useEffect(() => {
  const id = setTimeout(() => setShown(t), SCRUB_DEBOUNCE_MS);
  return () => clearTimeout(id);
}, [t]);
```

Keep a hook in the file that uses it; move it to its own `src/ui/<name>.ts` when a second file needs it.
