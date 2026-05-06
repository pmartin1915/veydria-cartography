# Handoff — 2026-05-04 Phase 2 "Journey Mode" Complete

## Commit
`a4bd344` — `feat(journey): Phase 2 Journey Mode — route planner, terrain cost overlay, seasonal gates`

## What Was Done

### Route Planner (`JourneyPlanner.tsx` + `journey-graph.ts`)
- **Graph construction** from GeoJSON: nodes = civilization centroids + all point features (ports, oases, landmarks, chokepoints, contested sites)
- **Edges**: trade routes (with length from LineString geometry), chokepoint connections (with type-based penalty: mountain_pass 2.5×, river_crossing 1.8×, maritime_strait 1.5×), intra-civilization links (points to nearest civ centroid)
- **Alias resolution**: `"basin"` trade route endpoint maps to `"aethelian_basin"` water feature centroid
- **Dijkstra shortest path** with distance, estimated days (25 km/day avg), and bottleneck collection
- **UI panel**: searchable start/end dropdowns, swap button, route timeline with node icons, segment labels, distance/travel time stats, bottleneck & seasonal warnings
- **Map integration**: highlighted dashed route lines, colored node markers (green=start, red=end, gold=waypoint), auto-fit bounds to route

### Terrain Cost Overlay
- New `terrain_cost` layer toggle in Geography group
- Colors terrain cells by elevation-based movement difficulty:
  - <500m: green (#4a9a3a) — easy
  - 500–1500m: light green (#8ab87a)
  - 1500–2500m: yellow-green (#c8d4a0)
  - 2500–3500m: yellow-brown (#e8d5a0)
  - 3500–4500m: orange (#d4a060)
  - 4500–5500m: red-orange (#c06040)
  - 5500m+: dark red (#803030) — nearly impassable
- Priority: terrain_cost > faction_control > elevation

### Seasonal Gates
- `SEASONAL_DATA` map in `journey-graph.ts` keyed by trade route id:
  - `coastal_monsoon`: SE trade season (late spring–early autumn) only
  - `caravan_thread`: desert crossing avoids high summer, Qalībin escorts required
- Maritime chokepoints (`halkar_straits`) get automatic monsoon warning
- Displayed in JourneyPlanner as "🌦️ Seasonal Restrictions" section

### Keyboard & UI
- New shortcut: `J` toggles journey planner
- Added to KeyboardHelp modal
- Journey button in header next to Measure
- `Esc` closes journey mode

## Files Changed
- `web/src/utils/journey-graph.ts` — new: graph builder + Dijkstra
- `web/src/components/JourneyPlanner.tsx` — new: route planner UI
- `web/src/components/MapViewer.tsx` — route overlay rendering, terrain cost coloring
- `web/src/components/LayerControls.tsx` — terrain_cost toggle
- `web/src/components/KeyboardHelp.tsx` — J shortcut
- `web/src/App.tsx` — journey mode state, route prop, keyboard handler
- `web/src/App.css` — journey planner styles (~300 lines)

## Active Issues
- **Build output directory**: `web/dist/` still locked by zombie Windows file handle. Workaround: `npx vite build --outDir dist2`

## Next Priority
Phase 3 ideas (not yet planned):
- Export journey route as shareable link / JSON
- Seasonal selector (spring/summer/autumn/winter) that filters monsoon-dependent routes
- Multi-stop journey (waypoints)
- Route comparison (fastest vs safest vs cheapest)
