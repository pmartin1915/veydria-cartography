# Handoff — 2026-05-08 (afternoon): three new features, mobile fixes, queued audit

*Continues from `HANDOFF-2026-05-08-audit-tests-and-master-doc.md`. That one closed audit item 7 and shipped MASTER.md. This one shipped a much larger batch and cleared all the smaller polish items, then ran three subagent-built features end-to-end. The next instance has three explicit asks at the bottom — read those first.*

## State at close

- Branch `master`, all commits pushed to `origin/master`. Working tree clean (`.claude/` is local-only and stays untracked).
- Tests: **84/84 pass** (was 38/38 at session open — added 46 across 3 new modules).
- CI: green on every push this session, ~22-30s per run.
- Build: `tsc -b && vite build`. Main bundle 326 kB / 100 kB gzip with leaflet/d3/html-to-image split into separate cacheable chunks. No vite chunk-size warning.
- Dev server: `cd web && npm run dev -- --host` exposes it on the LAN; Network URL was `http://192.168.1.208:5173/` last time (your IP may rotate).

## What landed (newest → oldest)

### Three new features (all data-layer + UI in pairs)

| Feature | Data SHA | UI SHA | Notes |
|---|---|---|---|
| Hex grid overlay | `f005a47` | `f0ae299` | Pointy-top + odd-r, ~221 hexes at hexSize=50, A1/G7-style labels, hover tooltip with terrain descriptors |
| Faction graph | `3a54336` | `a87ded2` | Modal SVG view, nodes positioned by civ centroid, edges per type (trade/hostile/etc), click → InfoPanel |
| Random encounter roller | `b7a0703` | `098d803` | "⟳ Roll one-off" button in the Encounters tab, gold-bordered Impromptu cards |

All three data layers came from parallel subagent dispatches with strict scoping (new files only, no UI touch). UI integrations were sequential in the main thread.

### Mobile-shape fixes

| SHA | What |
|---|---|
| `f30557c` | Map sizing (Leaflet `invalidateSize` + `100dvh` for iOS Safari address bar), layer panel collapses on mobile in BOTH modes (was share-only), SVG mojibake `&amp;#160;` → `&#160;` for region labels |
| `e9e29bb` | Journey planner becomes a bottom sheet on mobile (was a fixed 320px floater that ate the map), header overflow scrolls horizontally |
| `4a557ae` | Layer-controls collapsed launcher on mobile share, Measure hidden in share mode, 36px tap targets at ≤480px |

### Polish + closeouts

| SHA | What |
|---|---|
| `4799049` | Shift+click Snapshot for player-view variant (drops annotation pins) |
| `061d4c4` | Feature-count chip is now a search trigger, brighter player banner, code-split bundle |
| `e6866bb` | MASTER.md (project + roadmap + guided-tour design sketch), HANDOFF series cleanup, SVG mojibake first pass |
| `470de83` | Pinned audit item 7 (preset robustness) via 7 new vitest cases |

## Architecture deltas worth knowing

### Hex grid stack

- `web/src/utils/hex-grid.ts` — pure math + sampling, framework-agnostic
- `web/src/utils/hex-overlay.ts` — Leaflet SVG overlay, mirrors `d3-overlay.ts`'s lifecycle (`update / destroy / setVisibility / setOpacity / getHexAtSvg`)
- `web/src/components/MapViewer.tsx` — initialises the overlay, registers it in `layerGroupsRef` so the existing visibility-toggle effect handles it, plus a single floating-div tooltip driven by Leaflet `mousemove`
- `LayerVisibility` and `LayerOpacity` got `hex_grid` keys in App.tsx, mirrored in MapViewer's local interface and in `layer-presets.ts`'s `ALL_OFF` / `FULL_OPACITY` / Default + Player presets

**Hex descriptors come from elevation buckets**, not real biomes — `terrain_cell` features only carry `civ + elevation` today. Buckets: `Sea < 0`, `Plains < 200`, `Hill < 600`, `Highland < 1200`, `Mountain < 2000`, `Peak ≥ 2000`. Plus category words (`River`, `Oasis`, `Port`, etc.). Real biome strings need a `biome` field added upstream in worldbuilder's terrain_cell properties.

### Faction graph stack

- `web/src/utils/faction-graph.ts` — extracts `{ nodes, edges }` from GeoJSON + optional parsed YAML topology
- `web/src/components/FactionGraph.tsx` — modal SVG view, normalises centroids into a viewBox, click → `onSelectFaction(civId)` → App.handleFeatureClick
- "Graph" header button in App.tsx (GM-only)

**Today the canonical YAML has no `relationships:` block**, so the graph emits trade + shared_chokepoint edges only — zero hostile/allied/vassal until the topology is extended. The modal already legends those edge styles for when they show up.

### Encounter roller stack

- `web/src/utils/encounter-roller.ts` — non-deterministic `rollOneOff({ edgeType, season?, severity?, rng? })`, returns `Encounter | null`. `encounters.ts` got additive exports (`TRADE_ROUTE_BEATS`, etc.) for the roller to consume; no signatures changed.
- `web/src/components/JourneyPlanner.tsx` — `oneOffRolls: Encounter[]` state in the Encounters tab, reset on route-identity change
- `segmentIdx: -1` is the sentinel for "not bound to a segment", which the UI uses to badge cards "Impromptu"

**`{edgeType:'trade_route', severity:'severe'}` always returns `null`** because the trade pool has zero severe entries. Pool needs banditry / customs raid / plague-quarantine seeds before this is GM-friendly.

### Mobile shape

- `.app` uses `height: 100dvh` (with `100vh` fallback) so the root tracks the live iOS Safari viewport
- MapViewer calls `map.invalidateSize({ pan: false })` at t+0 and t+250ms, plus on `resize` and `orientationchange`. Without these the map sat in a thin slice of the viewport on first load.
- `LayerControls` collapses to a `≣ Layers` pill on viewports ≤768px regardless of share mode
- Journey planner is a bottom sheet on mobile (rules added inside the existing `@media (max-width: 768px)` block in `App.css`)

## What the next instance is asked to do

The user's words: "audit what we've fixed, improve the zooming, maybe expand on the hex grid a bit more by making it more extensive."

### 1. Audit the recent fixes

Walk through the verify-checklists in this handoff and the previous one. Specifically confirm on a real device (or DevTools mobile emulation at 375×667):

- [ ] Map fills the viewport (no dead space above) — the `invalidateSize` + `dvh` fix from `f30557c`
- [ ] On phone GM URL: layer panel is a `≣ Layers` pill at bottom-left, not the full panel
- [ ] On phone share URL (`#share=1`): banner is legible at low brightness; Measure button absent; toolbar can swipe sideways if it overflows
- [ ] Journey planner on phone slides up as a bottom sheet (with a small drag-handle bar at the top), not a floating 320px panel
- [ ] Region labels read cleanly: `NGARU-BON PLATEAU (4,000-6,000m)`, `OPEN OCEAN`, `IRRAH DRYLANDS` — no `&#160;`
- [ ] Hex grid: Geography → Hex Grid toggle. Hover tooltip reads `G7 · Hill, River` style. Labels disappear at low zoom.
- [ ] Roll one-off: Encounters tab → button → impromptu card prepended with gold left border
- [ ] Faction graph: header "Graph" button (GM-only) → modal with 6 civs as nodes, edges for trade routes and shared chokepoints, click civ → main-map InfoPanel opens
- [ ] PNG snapshot: normal click includes pins; Shift+click excludes them, toast says "Player snapshot…"

If anything regresses, fix and write a test for the regression. Tests next to code: `foo.ts` → `foo.test.ts`.

### 2. Improve the zooming

User reported the experience could be better. We didn't change zoom directly this session; the mobile sizing fix probably helped. Concrete things to investigate:

- **Default zoom level on first load.** Right now `map.fitBounds(bounds)` runs at init in `MapViewer.tsx:412`. On a tall phone viewport this might over-fit (continent fills width but most height is sea). Consider a max-zoom cap on the fit, or a min-zoom floor.
- **Pinch-zoom on touch.** Leaflet supports it natively but the wheel/pinch sensitivity may need tuning. Check `zoomSnap` and `zoomDelta` in the L.map options (currently un-set, defaulting to 1). A `zoomSnap: 0.5` makes pinch feel smoother.
- **Hex-grid label threshold.** `hex-overlay.ts:LABEL_MIN_ZOOM = 1` may be too aggressive on phone — labels disappear quickly. Try a viewport-aware threshold or move the cutoff to the tooltip-only mode.
- **`ZOOM_THRESHOLDS` map in `MapViewer.tsx:176`.** Some categories (e.g. landmark, oasis) only render above a threshold. On phone these thresholds may need lowering — currently a full-screen-fit zoom shows nothing because zoom < threshold.
- **Smoothness during zoom on mobile.** The `terrain_cell` layer uses `L.canvas({ padding: 0.1 })`. Padding `0.1` keeps the off-screen buffer small; on phone this might cause tile pop-in during pinch-zoom. Try `0.3`.
- **Animated fit-to-feature on tap.** When a user taps a feature on phone, the InfoPanel slides up and obscures the lower 65vh — but the map didn't pan to keep the feature centred above the panel. `map.flyTo(latlng, zoom, { paddingBottomRight: [0, sheetHeight] })` would help.
- **Gesture conflicts.** The mousemove tooltip handler in MapViewer fires constantly — on touch, this might intercept tap-to-select. Verify with `tap: true` in L.map options (default already true) and consider disabling the tooltip on touch entirely.

The right starting move is probably one round of measurement on a real phone (or DevTools throttled CPU) before changing values. Write down what you measure.

### 3. Expand the hex grid

User wants it "more extensive". A range of plausible directions in priority order:

**Higher-yield, smaller scope:**

- **Real biome words instead of elevation buckets.** Add a `biome` string field to `terrain_cell.properties` upstream in worldbuilder (`forest / steppe / desert / jungle / wetland / tundra`), sync via `npm run sync:data`, and update `hex-grid.ts:sampleHexFeatures` to prefer `biome` when present and fall back to elevation buckets when absent. This is the single change that gets you closest to actual Civ V vibes ("Forest, Plains, River").
- **Click-to-select a hex.** Currently hover-only. Add a `selectedHex` state in App.tsx; on click, pan-and-zoom to the hex, open a small persistent panel (like InfoPanel but smaller) listing coordinate, descriptors, neighbours, and any features fully inside it.
- **Persistent coordinate display.** A small chip in the bottom-left or near the compass showing the coordinate of the hex currently under the cursor (or selected hex on touch). "G7" by itself would help GMs reference the map verbally.
- **Hex grid in journey planner.** When a route is shown, highlight the hexes the route passes through, and add a "hexes traversed: 14" stat in the route summary.

**Bigger scope:**

- **Variable hex size from UI.** Slider in the Hex Grid layer controls (`hexSize: 30 / 50 / 70`) — gives the GM ~600 / ~220 / ~110 hexes respectively. Cache `generateHexGrid + sampleHexFeatures` keyed by (size, features), recompute only on size change.
- **Hex-distance measurement.** A "measure in hexes" mode (separate from the existing measure tool, which is straight-line km). Click two hexes → reports `axialDistance` and renders a path of intermediate hexes via `hex-grid.ts:hexNeighbors`.
- **Hex-grid layer presets.** Add a built-in preset "Tactical" that turns hex_grid on at higher opacity and turns terrain_cell down to 0.3. Right now it's manually-toggled.
- **Per-hex annotations.** Pin notes can be attached to a hex coordinate instead of an SVG point. The annotations module would learn an optional `hexLabel` field and the existing pin-drop UI would show "Linked to G7" instead of "Linked to Khulut".

Pick one or two; don't try to do all of them. The first three (biomes, click-to-select, coordinate chip) are probably the cleanest combo to ship in one session.

## Scratch / out-of-scope notes

- `data/veydria-topology.yaml` lacks a `relationships:` block — the faction-graph view won't show hostile/allied/vassal edges until that's added upstream in worldbuilder, then synced via `npm run sync:data`. Builder is shape-ready.
- `TRADE_ROUTE_BEATS` in `web/src/utils/encounters.ts` has zero severe entries; the roller's `severity:'severe'` filter for trade routes always returns `null`. Add 2-3 severe trade beats (banditry, customs raid, plague-quarantine) when convenient.
- Bundle is now 326 kB / 100 kB gzip with all three new features. Comfortably under any threshold worth caring about.

## Test layout (current)

```
web/src/utils/
├── annotations.test.ts        12   schema, migration, findNearestFeature
├── encounter-roller.test.ts    6   pool membership, filters, deterministic-with-stub-rng, empty-pool null
├── encounters.test.ts          4   determinism, season variation
├── faction-graph.test.ts      17   fixtures: nodes, trade edges, hostility, dedupe, missing topology
├── hex-grid.test.ts           23   pixel↔axial, neighbours, grid generation, descriptor sampling
├── journey-days.test.ts        9   bucketing math, determinism
├── journey-graph.test.ts       6   Dijkstra fix, civ-pivot fallback
└── layer-presets.test.ts       7   defensive merge, corrupt storage, every built-in carries every key
                              ───
                               84
```

Run with `npm test`.

## Repo references

- `MASTER.md` — broad project + world + roadmap doc; load this for orientation
- `README.md` — short tech-stack intro
- `AGENTS.md` — agent-onboarding (sync rules, do/don't)
- `HANDOFF-2026-05-08-audit-tests-and-master-doc.md` — the previous handoff
- `HANDOFF-2026-05-08b-features-and-mobile.md` — this doc
