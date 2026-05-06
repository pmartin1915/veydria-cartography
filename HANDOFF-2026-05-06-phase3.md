# Handoff — 2026-05-06 Phase 3 "Journey Enhancements" Complete

## Commits
- `b30fe4c` — `feat(journey): Phase 3 — route export, seasonal selector, waypoints, comparison modes`
- `7d43a02` — `chore: ignore dist2/ build output directory`

## What Was Done

### 1. Bug Fix — Callback Stability
**Problem:** `JourneyPlanner`'s reset effect fired on every `App` re-render because `onRouteComputed` was an inline arrow in `App.tsx`.
**Fix:**
- Wrapped `handleJourneyRouteComputed` and `handleJourneyClose` in `useCallback` in `App.tsx`
- Memoized `graph = useMemo(() => buildGraph(geojson), [geojson])` in `JourneyPlanner.tsx` so it doesn't rebuild on every "Find Route" click

### 2. Route Export
**Shareable links:** Journey start/end encoded in URL hash as `journeyFrom=` / `journeyTo=`. On page load with these params, journey mode auto-opens and the route auto-computes.
**JSON export:** Copies a structured payload with from/to names, distance, days, path, segments, and warnings.
**UI:** Two small buttons ("Link", "JSON") appear in the route results panel, with toast confirmation.

### 3. Seasonal Selector
**UI:** Row of season buttons — 🗓️ Any | 🌸 Spring | ☀️ Summer | 🍂 Autumn | ❄️ Winter
**Behavior:** When a season is selected, edges blocked in that season get a 10× penalty in Dijkstra. This makes the router avoid them if there's any alternative, while still finding a route if no alternative exists.
**Data model:** `SeasonalRestriction` type with `blockedIn: Season[]` and `riskyIn: Season[]`.
**Covered routes:**
- `coastal_monsoon` — blocked in winter (NW monsoon)
- `caravan_thread` — blocked in summer (high heat)
- Maritime chokepoints — blocked in winter (monsoon windows)

### 4. Multi-Stop Waypoints
**UI:** "+ Add waypoint" button below the End selector. Each waypoint has its own searchable dropdown and remove button. Max 4 waypoints.
**Behavior:** Route is computed as a series of Dijkstra legs (start → wp1 → wp2 → ... → end) via `findMultiStopRoute()`. Nodes are deduplicated at connection points. All stats (distance, days, bottlenecks, warnings) are aggregated across legs.

### 5. Route Comparison Modes
**UI:** Row of toggle buttons — Direct | Fastest | Safest | Cheapest
**Heuristics:**
- **Direct:** `weight = distanceSvg` (shortest path)
- **Fastest:** `weight = distance / speed` where trade_route=2.0×, intra_civ=1.0×, chokepoint=0.5×
- **Safest:** `weight = distance * risk` where trade_route=1.0×, intra_civ=1.2×, chokepoint=3.0×
- **Cheapest:** `weight = distance * cost` where trade_route=1.0×, intra_civ=1.0×, chokepoint=2.0×

Season and mode can be combined (e.g., "Fastest in Winter" avoids monsoon routes AND prefers trade routes).

## Files Changed
- `web/src/utils/journey-graph.ts` — `SeasonalRestriction`, `RouteMode`, `getEdgeWeight()`, `findMultiStopRoute()`, season/mode params
- `web/src/utils/url-hash.ts` — `journeyFrom`/`journeyTo` hash params
- `web/src/components/JourneyPlanner.tsx` — waypoints, season selector, mode selector, export buttons, auto-compute from URL
- `web/src/App.tsx` — stable callbacks, hash integration for journeys
- `web/src/App.css` — ~200 lines of new styles
- `.gitignore` — ignore `web/dist2/`

## Bundle Size
JS: 462KB → gzipped 141KB (up from 454KB / 139KB — ~8KB increase for all Phase 3 features)

## Active Issues
- **Build output directory:** Still outputs to `dist2/` due to locked `dist/` Windows file handle.

## Next Priority Ideas
- Journey history / saved routes sidebar
- Hover tooltips on route segments showing per-segment distance and time
- Visual distinction of route segments by type (different dash patterns for trade_route vs chokepoint)
- Elevation profile chart for a computed route
- Export route as ASCII art / markdown for session notes
