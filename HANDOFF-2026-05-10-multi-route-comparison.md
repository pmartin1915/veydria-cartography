# Handoff: Multi-route Comparison

## Branch
`auto/season-nothing-beats-2026-05-10`

## What shipped
**Multi-route comparison** — overlay Direct, Safest, and Cheapest routes simultaneously with distinct colours and side-by-side stat blocks.

### How it works

1. **JourneyPlanner** gets a new toggle: "Compare routes" (bar-chart icon). Only visible when there are no waypoints (simple A→B). Clicking it enters `compareMode`.

2. When `compareMode` is active and start/end are set, the auto-recompute effect calls `findComparisonRoutes(graph, startId, endId, season)` which computes all three routes in parallel.

3. Results flow:
   - `JourneyPlanner` → `onComparisonRoutesComputed` callback → `App.tsx` `comparisonRoutes` state → `MapViewer` `comparisonRoutes` prop

4. **MapViewer** renders comparison routes in a separate `comparisonRouteLayerRef` LayerGroup:
   - **Direct**: solid `#4a9a3a` (green)
   - **Safest**: dashed `#3a7ca5` (blue), dashArray `6,4`
   - **Cheapest**: dotted `#c4a862` (gold), dashArray `3,3`
   - Opacity: 0.65, weight: 4
   - Cleared independently via `clearComparisonRoutes()` on the imperative handle

5. **JourneyPlanner results area** shows three side-by-side stat cards when `compareMode` is on:
   - Colour-coded dot + label + "active" badge for the current mode
   - Distance / Travel time / Segments for each route
   - "No route" for missing routes
   - Clicking a card switches the active route mode (and re-renders the primary route)

### Files changed

| File | Change |
|---|---|
| `web/src/App.tsx` | Add `comparisonRoutes` state; pass to `MapViewer` and `JourneyPlanner` |
| `web/src/components/MapViewer.tsx` | Add `comparisonRoutes` prop; `comparisonRouteLayerRef`; render effect with distinct colours/dash patterns; fix `dashArray` type (`undefined` not `null`) |
| `web/src/components/JourneyPlanner.tsx` | Add `onComparisonRoutesComputed` prop; `compareMode` state; `comparisonRoutes` state; toggle UI; auto-recompute comparison routes; side-by-side stat cards |
| `web/src/App.css` | Styles for `.journey-compare-toggle`, `.journey-compare-btn`, `.journey-comparison-stats`, `.journey-comparison-card`, etc. |
| `MASTER.md` | Mark shipped; update test count 328/328; remove from backlog |

### Stats

- `tsc --noEmit`: clean
- `vite build`: green
- `vitest run`: **328/328 passing** (21 files)
- `pipeline.py validate`: green

## Open questions / follow-ups

- The comparison cards are a bit dense on very narrow mobile panels. Consider collapsing to a vertical stack below ~360px.
- Could add a "best in class" indicator (e.g. a small trophy icon on the card with the shortest distance, shortest time, or fewest segments).
- Could expose the comparison data in the campaign log export.
