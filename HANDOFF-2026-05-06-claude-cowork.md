# Handoff — Claude Cowork Deep Research Session
*Date: 2026-05-06*  
*Repo: `veydria-cartography` at `C:\Users\perry\DevProjects\veydria-cartography`*  
*Head commit: `1e04574` — "feat(journey): history sidebar + markdown export"*

---

## 1. Project Overview

**Veydria Cartography** is a procedural map generation + interactive web map for the fictional continent of Veydria. It serves two purposes:
1. **Static map image** — matplotlib-generated parchment-style continental map
2. **Interactive web map** — pan/zoom Leaflet viewer with clickable lore markers, trade routes, terrain overlays, and a full journey planner

Both are driven from canonical data in `data/veydria-topology.yaml` (copied from the `worldbuilder` repo).

### Live Dev Server
Currently running at `http://localhost:5174` (port 5173 was occupied).

---

## 2. Architecture

### Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vite 6 + React 19 + TypeScript |
| Map engine | Leaflet (CRS.Simple for SVG coordinate space) |
| Vector overlays | D3.js (trade routes rendered as SVG paths on Leaflet overlay) |
| Backend | Python 3.10 — PyYAML → NetworkX → scipy.spatial.Voronoi → Shapely |
| Static render | matplotlib rasterization |
| Data sync | `node scripts/sync-world-data.mjs` copies from `worldbuilder/` |

### Key Frontend Files (18 TS/TSX files)
```
web/src/
├── App.tsx                    # Main container, viewport state, layer visibility
├── App.css                    # ~2,400 lines, dark parchment theme
├── components/
│   ├── MapViewer.tsx          # Leaflet map, D3 overlay, journey route renderer
│   ├── InfoPanel.tsx          # Clickable feature detail panel with lore cross-ref
│   ├── LayerControls.tsx      # Layer toggles + opacity sliders
│   ├── SearchBar.tsx          # Global feature search with keyboard shortcut
│   └── JourneyPlanner.tsx     # Route planner UI (see §4)
├── utils/
│   ├── journey-graph.ts       # Graph construction + Dijkstra pathfinding
│   ├── journey-history.ts     # localStorage persistence for saved routes
│   ├── d3-overlay.ts          # D3 trade route SVG overlay on Leaflet
│   ├── url-hash.ts            # Viewport + journey param serialization
│   └── measure.ts             # SVG→km conversion, distance formatting
```

### Key Backend Files
```
generator/
├── core/                      # YAML parsing, graph building, geometry, persistence
├── render/                    # matplotlib rasterization, tiling
├── export/                    # GeoJSON conversion
└── pipeline.py                # CLI entry point
```

---

## 3. Current Feature State (Committed)

### Map Layers (all toggleable + opacity sliders)
- Terrain cells (~3,072 polygons) — elevation-colored or terrain-cost-colored
- Rivers, water bodies
- Civilization polygons
- Ports, chokepoints, oases, contested sites, landmarks (SVG markers)
- Trade routes (D3 SVG overlay with animated particles)
- Faction control overlay (tints terrain by civilization)
- Terrain cost overlay (movement difficulty heatmap)

### InfoPanel
- Click any feature → panel slides in with name, category, type, description
- Cross-references worldbuilder lore (population, government, exports, etc.)
- Related features list (e.g., ports in a civilization)
- Travel time estimates from selected feature to all others

### Journey Mode (4 phases built)
| Phase | Feature | Commit |
|-------|---------|--------|
| 1 | Basic route planner (start→end, Dijkstra) | a4bd344 |
| 2 | Terrain cost overlay, seasonal gates, multi-civ routing | a4bd344 |
| 3 | Callback stability fix, route export (URL + JSON), seasonal selector, multi-stop waypoints (up to 4), route comparison modes (direct/fastest/safest/cheapest) | b30fe4c |
| 4 | Visual segment styling (color/dash per edge type), per-leg hover tooltips with distance/days/warnings | 276321a |
| 5 | Journey history sidebar (localStorage, save/load/delete, dedup), Markdown export for session notes | 1e04574 |

### Journey Graph Detail
- **Nodes:** 25+ (civilization centroids + named points)
- **Edges:** trade routes, chokepoint connections, intra-civilization links
- **Algorithm:** Dijkstra with mode-specific weight functions
- **Seasonal penalties:** 10× cost for blocked edges (soft avoidance)
- **Speeds:** trade_route=50km/day, chokepoint=12.5km/day, intra_civ=25km/day

---

## 4. Known Issues & Technical Debt

### Active
| Issue | Severity | Details |
|-------|----------|---------|
| **Locked `dist/` handle** | Medium | Windows file handle zombie holds `web/dist/`. Workaround: `vite.config.ts` outputs to `dist2/`. Fix requires reboot or Resource Monitor. |
| **Bundle size creeping** | Low | JS 470KB → 143KB gzipped. Acceptable but worth monitoring. Leaflet + D3 + React are the bulk. |
| **D3 trade route overlay z-fighting** | Low | Trade routes occasionally render under terrain cells at certain zooms. D3 overlay doesn't participate in Leaflet's z-index system. |
| **JourneyPlanner reset on URL defaults** | Low | `didAutoComputeRef` prevents double-compute but the logic is slightly fragile if defaults change mid-session. |

### Architectural Debt
- **Graph rebuilt on every "Find Route"** — mitigated by `useMemo` in JourneyPlanner, but `findMultiStopRoute` chains Dijkstra calls without caching sub-routes
- **GeoJSON mutation risk** — `buildGraph` reads from the GeoJSON object directly; if anything mutates properties, side effects propagate
- **No tests** — zero test coverage across the entire project (frontend + backend)
- **D3 overlay is one-off** — `initD3Overlay` creates its own SVG layer; adding more D3 layers would require refactoring

---

## 5. Data Pipeline

### Canonical Source
The `worldbuilder` repo at `C:\Users\perry\DevProjects\worldbuilder` is the source of truth:

```
worldbuilder/geography/
├── continents/veydria-topology.yaml   → data/veydria-topology.yaml
├── MAP-PROMPT.md                      → data/MAP-PROMPT.md
└── veydria-schematic.svg              → data/veydria-schematic.svg
```

Sync command: `node scripts/sync-world-data.mjs` (or `npm run sync:data` from `web/`)

### GeoJSON Generation
```
generator/pipeline.py export-geojson
```
Produces `output/veydria-spatial.geojson` (~3,052 features, ~3.2MB) which is then copied to `web/public/veydria-spatial.geojson` for the frontend.

---

## 6. Research Questions for Claude Cowork

### A. What Should Phase 6+ Be?
Current ideas from the backlog:

1. **Animated route traversal** — a moving dot/pawn that travels the computed route over time, showing progress
2. **Elevation profile chart** — D3 or Chart.js line graph showing elevation change along the route
3. **Weather/encounter generator** — procedural events based on terrain type, season, and route segment
4. **Multi-party route comparison** — show 2-3 routes side-by-side on the map (e.g., fastest vs safest)
5. **Terrain-cell-level pathfinding** — A* through the 3,000 terrain cells instead of the abstract graph (much higher fidelity but computationally expensive)
6. **Print/export map image** — generate a PNG of the current viewport with all active layers
7. **Mobile responsiveness** — the UI is desktop-optimized; mobile would need a bottom sheet pattern
8. **Real-time collaboration** — WebSocket sync of viewport + selected features for multiplayer session prep

**Question:** Which of these has the highest value/effort ratio? Are there better ideas not on this list?

### B. Architecture & Scalability

1. **Should the frontend compute the graph, or should the backend?** Currently `buildGraph()` runs in the browser on every mount. With 3,000+ features this is fine now, but as the world grows...
2. **Should we switch from Leaflet to MapLibre GL?** MapLibre has better performance for large GeoJSON datasets and native vector tile support. But we'd lose the simple SVG-image-overlay approach.
3. **Should trade routes stay in D3 or move to Leaflet GeoJSON?** The D3 overlay gives us animated particles, but it complicates hit-testing and z-index management.
4. **Bundle splitting opportunity?** Journey planner is ~40% of the JS bundle but only used when activated. Could it be lazy-loaded?

### C. Data Model Evolution

1. **The topology YAML is hand-authored.** As the world grows, should this be procedural too? Should it be a database?
2. **Coordinate manifest drift** — `coordinate-manifest.yaml` stores manual coordinate overrides. This is fragile. Should coordinates be in the YAML directly?
3. **Worldbuilder integration depth** — Currently we only copy 3 files. Should the map app query worldbuilder's data directly (e.g., via an API or shared package)?

### D. User Experience Gaps

From a tabletop RPG player's perspective, what's missing?

1. **No measure tool legend** — distances are in SVG units internally; the user sees km but there's no scale reference on screen beyond the Leaflet scale bar
2. **No "fog of war" / exploration mode** — All features are always visible. For actual gameplay, players might only know features they've discovered.
3. **No notes/annotations** — Users can't pin their own markers or write session notes on the map
4. **No timeline / historical view** — The map shows the present state; there's no way to view past borders, extinct trade routes, etc.

### E. Performance Benchmarks Needed

We have no data on:
- `buildGraph()` execution time on low-end devices
- Frame rate during zoom with all layers enabled
- GeoJSON parse time on mobile
- D3 particle animation CPU usage

**Question:** What performance profiling should we prioritize?

---

## 7. Related Projects

| Project | Path | Relationship |
|---------|------|-------------|
| `worldbuilder` | `C:\Users\perry\DevProjects\worldbuilder` | Canonical lore source — geography, factions, magic, religion |
| `veydria-atlas` | `C:\Users\perry\DevProjects\veydria-atlas` | Geography/resource data companion |
| `game-ecosystem` | (not on disk) | Engine integration — planned future consumer |

---

## 8. Commands Reference

```bash
# Frontend dev
cd web && npm run dev          # localhost:5173 (or next available)

# Frontend build
cd web && npm run build        # outputs to dist2/ due to locked dist/

# Data sync
node scripts/sync-world-data.mjs

# Backend
cd generator
python pipeline.py validate          # Validate topology YAML
python pipeline.py export-geojson    # Generate GeoJSON
python pipeline.py info              # Civ/chokepoint/route summary
```

---

## 9. Files to Read First (for deep context)

1. `data/veydria-topology.yaml` — The spatial source of truth (~800 lines)
2. `web/src/utils/journey-graph.ts` — Graph + Dijkstra implementation (~500 lines)
3. `web/src/components/MapViewer.tsx` — Leaflet + D3 rendering (~850 lines)
4. `web/src/components/JourneyPlanner.tsx` — Route planner UI (~800 lines)
5. `generator/pipeline.py` — Backend CLI entry point
6. `AGENTS.md` — Agent context (project conventions, do-not-touch rules)

---

## 10. Open Design Decisions

1. **Should journey waypoints be draggable on the map?** (click map to set start/end/waypoints instead of dropdowns)
2. **Should the journey planner be a modal instead of a sidebar?** On small screens the sidebar consumes too much space.
3. **Should we add a minimap / overview inset?** For context when zoomed in.
4. **Should routes have "difficulty classes"?** (e.g., "safe for merchant caravans" vs "only for seasoned explorers")

---

*End of handoff. The dev server is running at http://localhost:5174 for live testing.*
