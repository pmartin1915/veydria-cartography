# Phase 6+ Research — What to Build Next

*Date: 2026-05-06*
*Author: Cowork research session, building on the 2026-05-06 handoff*
*Repo head: `1e04574` — feat(journey): history sidebar + markdown export*

---

## TL;DR

After reading `journey-graph.ts`, `MapViewer.tsx`, `JourneyPlanner.tsx`, `pipeline.py`, the topology YAML, and `AGENTS.md`, here is the recommendation in one paragraph:

**Phase 6 should be "Living Cargo" — surface the lore that's already in the YAML through three small, composable additions: lore-rich segment tooltips (commodities, consequence-if-closed, etymology), a deterministic encounter generator seeded by route signature, and pin-able map annotations persisted in localStorage. This combines two of the eight backlog items (#3 weather/encounters and a slice of #6 print/export) and adds annotations from §6.D, leans entirely on data that already exists, and turns the planner from "shows you a route" into "produces a session-ready handout." Animated route traversal (#1), terrain-cell A* (#5), MapLibre migration, and real-time collaboration are all explicitly *not* recommended for this phase.**

The longer reasoning, including what I evaluated and rejected, is below.

---

## 1. Why "Living Cargo" wins the value/effort race

Reading the YAML against the journey planner is the punchline. The topology file is dense with TTRPG-grade detail:

- `trade_routes.copper_for_steel_road.commodities`: "Copper northbound; finished steel/iron southbound"
- `trade_routes.caravan_thread.consequence_if_closed`: "Salt supply to southern continent collapses. Irrah iron imports cease. Continental banking network (khatti letters of credit) breaks — Qalībin oath-binders are the de facto banking infrastructure"
- `aethelian_basin.functional_zones.tavakh_qarat.etymology`: "Mixed Basin pidgin: tavakh (Irrah-derived 'exchange, balance') + qarat (Irrah 'citadel'). The Exchange Citadel"
- `biological_barriers.tsetse_belt.consequence`: "Metallurgical apex with no cavalry = cannot project force overland. Forces trade through coastal intermediaries"

The journey planner currently surfaces *one* of these fields per route — `bottleneck` (mapped to YAML's `strategic_value`). The other six or seven fields per route are already paid for, just not rendered. That is the cheapest form of value creation available: pure UI work over existing data, no new types, no schema changes, no graph changes.

The encounter generator builds on the same observation. The segments produced by `findRoute` already carry edge `type` (trade_route / chokepoint / intra_civ), `seasonal` flags, and `bottleneck`. Combine those with the `terrain` strings on civilizations and `biological_barriers` and you have all the inputs a deterministic encounter table needs. Seed the random with a hash of the route signature (start id + waypoints + end id + season + mode) and the same route always rolls the same encounters — which is what you actually want for a shareable, reproducible session prep doc.

Annotations are the third leg. They aren't lore-driven, but every other capability above produces a *handout* — and a handout the GM can't write notes on is a printout, not a working document. Annotations make the map a workspace.

---

## 2. Phase 6 spec (proposed)

### 2.1 Lore-rich segment cards

**What:** Replace the existing per-segment hover tooltip in `MapViewer.tsx` (lines 786–794) with a richer card that shows, when available:

- Route name and edge type (already shown)
- Distance and days (already shown)
- Commodities flowing in each direction (new — from `trade_route.commodities`)
- Consequence if closed (new — from `trade_route.consequence_if_closed`)
- Bottleneck description (already shown — keep)
- Seasonal warning (already shown — keep)
- For chokepoints: type (mountain_pass / river_crossing / etc.) and historical note if present

Same idea on civilization markers and waypoint nodes: surface `etymology`, `function`, `real_world_parallel` for port zones; `borders`, `basin_access`, `terrain` for civilizations.

**Cost:** Small. The data is already in GeoJSON properties (verify in `generator/export/geojson.py`). UI is one tooltip component plus CSS. No graph changes.

**Risk:** None substantive. Worst case: tooltip becomes too tall — solve with a max-height + scroll, or move to a side-panel "segment detail" pattern instead of hover.

### 2.2 Deterministic encounter generator

**What:** New `web/src/utils/encounters.ts`. Takes `{ route, season, partySize? }` and returns `Encounter[]` — one per segment, sometimes a second for long legs. Each encounter is `{ segmentIdx, beat, type, severity, narrative }`.

**Seeding:** `mulberry32(hash(route.nodes.map(n => n.id).join('|') + season + mode))`. Deterministic and shareable — copy the journey link, get the same encounters.

**Tables:** Hand-authored per terrain/edge-type, leveraging the YAML:
- `chokepoint` + `mountain_pass` → "Lam-Chen pass guards demanding toll", "rockfall blocks the trail", "smith-pilgrim looking for an escort"
- `trade_route` + `coastal_monsoon` + `summer` → "merchant convoy invites you aboard", "cyclone warning at Halkar Straits", "Oravan wave-tithe collector"
- `intra_civ` + `irrah` → "oasis hospitality", "Qalībin path-finder negotiation", "salt caravan crossing"

These are short prompt seeds, not finished prose — the GM dresses them. Aim for ~30 distinct beats covering the realistic combinations. ~200 lines of TS.

**UI surface:** A new "Encounters" tab in the planner result, alongside the existing Path / Bottlenecks / Seasonal sections. Markdown export gets an "Encounters" section.

**Cost:** Medium. The bulk is content design, not code. The seeded RNG and table-rolling are ~50 lines.

**Risk:** Low if treated as content, not as a procedural engine. Avoid the rabbit hole of "encounter difficulty curves" — that's a different product.

### 2.3 Map annotations

**What:** A pin tool. Click the pin button → next map click drops a pin at SVG coordinates. Pin has `{ id, x, y, label, body, color, createdAt }`. Click pin → edit panel. List of pins in a sidebar. Persisted to localStorage under `veydria-annotations-v1`. Export-with-route option in the markdown handout.

**No sharing/sync.** That's a Phase 7 problem if it ever happens. localStorage is enough for a GM running a session on one laptop.

**Cost:** Small-medium. ~150 lines TS, plus a panel and a marker style. The hardest part is the edit-pin UX.

**Risk:** Stale pins after coordinate-manifest changes. Mitigate by attaching pin coords directly in SVG space (already what the rest of the app uses) — pins drift only if the SVG itself changes, same as everything else.

### 2.4 Print/export viewport (deferred from #6)

**Optional stretch.** Add a "Capture viewport" button that uses `dom-to-image` or `html2canvas` to dump the current map state to PNG. Useful for sharing handouts. ~50 lines, but `html2canvas` adds 50KB gzipped — only do it if the markdown handout proves insufficient.

**Recommendation:** ship Phase 6 without this; revisit in Phase 7 once we have feedback on whether annotations + markdown export already cover the "I want to save this for the session" need.

---

## 3. Why I rejected the other backlog items (for now)

| Idea | Verdict | Reasoning |
|---|---|---|
| **#1 Animated route traversal** | Skip | Charm without utility. The route is already drawn statically with all the same information. A moving dot doesn't help session prep, doesn't reveal new lore, and would conflict with the existing D3 trade-route particles. Build it later as polish if Phase 6 lands well. |
| **#2 Elevation profile chart** | Hold | Genuinely useful, but we don't have elevation samples along trade routes — only on terrain cells. Doing it correctly means rasterizing the route polyline against the terrain grid, sampling at intervals, and rendering with Chart.js. That's two days of work for a feature most TTRPG users will glance at once. Revisit when there's a "tactical fidelity" use case. |
| **#3 Encounter generator** | **Yes** | Recommended above as Phase 6.2. |
| **#4 Multi-route comparison** | Half-yes | The mode buttons (direct/fastest/safest/cheapest) already give a comparison if you click each. A side-by-side rendering on the map with two colored routes is genuinely useful but introduces overlap/legibility problems that need design work. Cheaper to add a "compare modes" diff view in the planner sidebar (numbers only) than to fight z-index in Leaflet. |
| **#5 Terrain-cell A\*** | Skip indefinitely | The current 25-node abstract graph is the *correct* abstraction for travel planning at "weeks of travel" timescales. A* through 3,000 cells gives you the ability to route around individual rivers, which is solving a problem nobody is asking about. The hidden cost: it would require terrain cells to be exposed as a real adjacency graph in GeoJSON, which means changing the export. Don't. |
| **#6 Print/export PNG** | Stretch | Captured under Phase 6.4 as deferred. The markdown handout is the better primary delivery vehicle. |
| **#7 Mobile responsiveness** | Hold | The journey planner sidebar is 360–400px wide; on mobile that's the whole screen. Real mobile support means a bottom-sheet pattern, repositioned compass, larger tap targets, gestural map controls, and a different InfoPanel. That's its own phase, not a sub-task. Defer until there's a real mobile use case (i.e., players opening this at the table on a tablet — possible — vs. on a phone — unlikely for prep). |
| **#8 Real-time collaboration** | Skip indefinitely | This requires a server, auth, presence protocol, conflict resolution, and a hosting story. The existing app has none of those things and works happily as a static site. Worldbuilder + map data both live in the user's repos. Don't add a backend without a screaming user. |

---

## 4. Architecture verdicts (§6.B)

Reading the actual code dissolves most of these worries.

**Should the graph compute on the frontend?** Yes, indefinitely. `buildGraph` traverses ~25 named features and ~3,000 terrain cells (which are skipped for graph purposes). It's `useMemo`'d. On any device made after 2018 this is a sub-millisecond operation. Profiling not needed; eyeball confirms.

**Leaflet vs MapLibre?** Stay on Leaflet. The current model — SVG image overlay with CRS.Simple, polygons drawn from GeoJSON, divIcon markers — works well for an artistic, hand-drawn-feel map. MapLibre's strengths are vector tile streaming and GPU-accelerated rendering of large datasets, neither of which is the bottleneck here. The migration cost (rewriting layers, markers, the D3 overlay integration, the measure tool, the journey route renderer) is multiple weeks. There is no problem to solve.

**Trade routes in D3 vs Leaflet GeoJSON?** Stay on D3. The animated particle effect is part of the parchment-map aesthetic; moving to a Leaflet GeoJSON layer would lose it. The z-fighting issue at certain zooms (handoff §4) is real but minor — fix it in `d3-overlay.ts` by setting `pointer-events: none` on the SVG container and handling clicks via the underlying Leaflet polyline you'd add as a hit-test layer. That's a one-day fix, not a refactor.

**Lazy-load the journey planner?** Yes — easy win. `JourneyPlanner.tsx` is only mounted when `active` is true, but it's still in the main bundle. `React.lazy(() => import('./components/JourneyPlanner'))` plus a `Suspense` boundary should peel ~40% of the JS bundle behind a click. Estimate 2 hours of work plus a build verification.

**Tests?** Add a small Vitest suite for `journey-graph.ts` — Dijkstra correctness, multi-stop concatenation, seasonal penalty, alias resolution. About 100 lines, maybe 200. Don't bother testing components yet; the surface is changing too fast and Storybook + manual smoke testing are cheaper.

---

## 5. Data model verdicts (§6.C)

**YAML vs procedural/DB?** The YAML is hand-authored because the world is hand-authored. Procedural geography would betray the project's premise. As the world grows, the right next step isn't a DB — it's splitting the YAML by region or by aspect (already done in `worldbuilder/`) and re-synthesizing. We're nowhere near needing a database; we're not even close to needing a search index.

**Coordinate manifest drift?** This is real and will bite. The manifest is a sidecar that `persistence.py` reconciles against the YAML. The right long-term move is to inline coordinates into the YAML (`civilization_positions.<civ>.centroid: [x, y]`) and retire the manifest. That's a migration, but a small one, and it removes a class of bugs where manifest and YAML disagree. Treat it as a Phase 7+ cleanup, not a Phase 6 task.

**Worldbuilder integration depth?** Stay copy-based. An API or shared package would couple two repos that currently have a clean handoff: worldbuilder authors lore, sync script copies it, cartography renders it. Tight coupling would make worldbuilder edits riskier and would require a release process. The current `node scripts/sync-world-data.mjs` is a feature, not a debt.

---

## 6. UX gaps (§6.D)

| Gap | Verdict | Notes |
|---|---|---|
| Measure tool legend | Build with Phase 6 | Tiny: a "1 cm = X km" callout on the scale bar. Pull from `measure.ts`'s SVG→km factor. ~10 lines. |
| Fog of war / exploration mode | Build in Phase 7 | Genuinely high TTRPG value, but requires a new persistence shape (per-feature `discovered` state) and a UX (reveal mechanic, party-discovers-this button, all-features button). Worth its own phase. |
| Annotations / notes | **Build now** | Phase 6.3 above. |
| Timeline / historical view | Hold | This is "what does the map look like in year X" — it requires the YAML to grow temporal versioning, which it doesn't have yet. Worldbuilder side question, not cartography. |

---

## 7. Open design decisions (§10)

- **Draggable waypoints on the map?** Worth it. Currently waypoints are added via dropdown — fine for power users, awkward for first-time users. Add a "click on the map to set start" mode that the planner enters when the user clicks a "pick on map" button next to the From/To/Via inputs. Phase 6.5 stretch goal.
- **Modal vs sidebar planner?** Keep sidebar on desktop. Modal would block the map, and the whole point is *seeing the route as you build it*. Mobile would need a bottom sheet — see §3 row #7.
- **Minimap inset?** Low value. The continent fits on screen at default zoom; a minimap is mostly useful when you're zoomed in deep, which is rare for this map. Skip.
- **Route difficulty classes?** Yes, but cheap. Derive from the existing edge weights: a route that's mostly trade_route edges = "merchant-grade", mostly chokepoints = "explorer-grade". One function, displayed on the route summary card. Add to Phase 6.

---

## 8. What I'd do this week (concrete sequence)

The total scope of Phase 6 above is roughly two productive weeks of frontend work. If I were sequencing it:

1. **Day 1 (half day):** Verify GeoJSON properties carry `commodities`, `consequence_if_closed`, `etymology`, `function`. If not, add to `generator/export/geojson.py` and re-run `pipeline.py export-geojson`. This is a blocker for Phase 6.1.
2. **Days 1–2:** Phase 6.1 (lore-rich segment cards). Pure UI work in `MapViewer.tsx` and `InfoPanel.tsx`. Visible reward: hovering a route now reveals real lore.
3. **Days 3–5:** Phase 6.2 (encounter generator). Build `encounters.ts` with the seeded RNG and ~30 hand-authored beats. Add the Encounters tab to the planner. Extend markdown export.
4. **Days 6–8:** Phase 6.3 (annotations). Pin tool, edit panel, localStorage persistence, markdown integration.
5. **Day 9:** Polish — measure scale legend (§6 row 1), route difficulty class (§7 row 4), lazy-load journey planner (§4 row 4).
6. **Day 10:** Vitest harness + 8–12 tests on `journey-graph.ts`. Commit.

After this phase, the headline UX claim changes from "interactive map of Veydria" to "session prep tool for Veydria" — which is what the data has always supported but the app has been one step short of delivering.

---

## 9. Things deliberately excluded

- I did not propose any backend changes. The Python pipeline is in good shape, the YAML schema is sound, and `pipeline.py info` is genuinely useful. No work needed there for Phase 6.
- I did not propose any tests beyond `journey-graph.ts`. Test debt is real but the surface is shifting; comprehensive tests are premature.
- I did not propose CSS or theming work beyond what the new components require. The dark parchment theme works.
- I did not propose performance work. The handoff lists "no measurements" as a concern (§6.E) — I agree we don't have measurements, but the app feels responsive and the only realistic perf risk is the 3,000-polygon terrain layer, which already uses `L.canvas` (line 268 of `MapViewer.tsx`). Don't optimize without evidence.

---

## 10. Open questions for Perry

1. **Encounter content tone** — should the beats lean heavy on the established lore (Qalībin path-finders, Khazadari money-changers, wave-tithes) or stay generic so they're transferable? My instinct is heavy lore: the lore is the moat.
2. **Annotation export model** — should annotations export with the route markdown, or be a separate "campaign notes" export? Or both?
3. **Are there session-prep workflows you've actually run with the current tool?** That would calibrate which of these proposals is hitting real friction vs. imagined friction.

---

*End of research doc. Resume points: §2 spec, §8 concrete sequence.*
