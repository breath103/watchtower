# ~100-line component limit — break it down

If a component function is past ~100 lines, stop and ask why it is so complicated and how it splits into smaller,
obvious pieces. A component that doesn't fit on a screen is where duplicated markup, tangled state and hidden coupling
pile up.

Common ways a component balloons:

- **Inline sub-blocks** — toolbars, empty states, a row of a table, an overlay. Extract a named component
  (`TimelineBar`, `CameraCard`, `StorageDialog` are examples of this already done).
- **Repeated UI** — the same pill / segmented button / form row in several places. Lift it into one component.
- **Branching on a union** — one function returning different JSX per `mode.kind`. Split each branch out and dispatch
  with a small `switch`.
- **Mixed concerns** — fetching, editing state and presentation in one body. Move the state cluster into a named hook
  (`frontend/extract-clusters-of-usestate-useeffect-useref-into-named`), leave the component to render.

Treat 100 as the smell threshold, not a hard limit; a component that is genuinely clearer at 130 lines can stay. One
that is 250 cannot.

## How to split

`src/ui/` is flat, kebab-case files. Small private sub-components stay in the same file below the exported one. When a
file grows several sizeable components, move them to sibling files named after what they render
(`watch.tsx` → `timeline-bar.tsx`) and import them directly — no barrel `index.ts`.
