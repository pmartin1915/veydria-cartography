# Handoff — Map + Compendium Merge + Historically Grounded Tone Pivot

**Date:** 2026-05-15
**Instance:** Kimi Code CLI → Claude Cowork
**Context:** User is switching to Claude to merge the two map applications and pivot all narrative content to a more realistic, adult, historically accurate fiction tone.

---

## The Two-Map Architecture (Critical Context)

There are **two separate map applications**. The user has been using both and wants them unified.

### 1. `veydria-cartography` — The Rich GM Workbench

**Path:** `C:\Users\perry\DevProjects\veydria-cartography`

| Attribute | Value |
|---|---|
| Purpose | GM session workbench — tactical play, prep, reference |
| Stack | Vite + React 19 + Leaflet (react-leaflet) + D3.js overlay |
| Tests | 489/489 pass (27 files, vitest) |
| Build | ~470 kB JS, ~113 kB CSS |
| Map | Leaflet with GeoJSON overlay, pan/zoom, SVG schematic underlay |
| Features | Hex grid, journey planner (Dijkstra + civ pivot), session HUD, session prep panel, AI Lore panel, calendar layer, time-of-day overlay, measure tool, search palette (Cmd-K), faction graph, saved journeys, multi-route comparison, per-feature GM notes, adventure hooks, annotations/pins, player share mode (`#share=1`), PNG snapshot, guided tour |
| Data source | `data/veydria-topology.yaml` (synced from worldbuilder) → `public/veydria-spatial.geojson` |
| Dev server | `npm run dev` (currently running on `192.168.1.208:5173`) |

**Key files:**
- `web/src/App.tsx` — layer state, session state, routing glue
- `web/src/components/MapViewer.tsx` — Leaflet + D3 overlay
- `web/src/components/InfoPanel.tsx` — right-side feature detail
- `web/src/components/JourneyPlanner.tsx` — routing + encounters
- `web/src/components/SessionPrepPanel.tsx` + `SessionHud.tsx` — session prep tools
- `web/src/components/SearchBar.tsx` — Cmd-K palette
- `data/veydria-topology.yaml` — canonical geography (read-only here, edit in worldbuilder)

### 2. `worldbuilder/tools/map-viewer` — The Compendium-Connected Map

**Path:** `C:\Users\perry\DevProjects\worldbuilder\tools\map-viewer`

| Attribute | Value |
|---|---|
| Purpose | Narrative browsing — read lore, explore entity relationships, see where concepts live geographically |
| Stack | Vite + React 18 + D3 (d3-selection, d3-zoom) + marked |
| Tests | None (no test framework) |
| Build | ~587 kB JS (slower build, no test gate) |
| Map | D3 SVG-based continental map (not Leaflet), simpler interaction |
| Features | **Compendium tab** with: entity browser, ego-network graph, calendar compare (7 civs × 8 sections), cross-civ matrix card grid, civilization browser, continental lenses (8 lenses: Calendars, Cross-civ Relationships, Crises, Magic Systems, Theological Traditions, Resource Governance, Institutions, Named Figures), markdown rendering, family-filter chips, search across 188 entities, URL-persisted state |
| Map-compendium bridge | `map_anchor` field on 20 entities → click "Map" in compendium → fly to geographic location, auto-enable layer, open popup |
| Data source | `src/generated/geography.json` (bundled from `geography/**/*.yaml` + `positions.yaml`) + `design/narrative-schema/canon.json` (188 entities) + `search-index.json` (fetched at runtime) |
| Dev server | `npm run dev` (separate port, typically 5174 if cartography is on 5173) |

**Key files:**
- `src/App.jsx` — hash routing (`#map` / `#compendium`), tab switcher
- `src/components/ContinentalMap.jsx` — D3 SVG map
- `src/components/CompendiumView.jsx` — compendium container, search, tab state
- `src/components/compendium/EntityDetail.jsx` — entity detail with "Map" button
- `src/components/compendium/EgoNetwork.jsx` — radial relationship graph
- `src/components/compendium/CalendarCompare.jsx` — 7×8 calendar grid
- `src/components/compendium/MatrixCardGrid.jsx` — cross-civ dyad cards
- `src/components/compendium/CivilizationsView.jsx` — per-civ entity listing
- `src/components/compendium/LensesView.jsx` — 8 lens tiles
- `src/components/compendium/GlobalOverview.jsx` — browse grid
- `src/components/compendium/shared.js` — constants, utilities, `displayName()`
- `src/data/load.js` — geography data loading, `lookupEntity()`, `lookupPosition()`
- `design/narrative-schema/canon.json` — 188 entities with metadata + body summaries
- `design/narrative-schema/search-index.json` — full-text search index (247 KB)
- `design/narrative-schema/map-anchors.json` — 20 curated compendium→map mappings

---

## The Merge Mission

**Goal:** Unify these into a single application. The user should open one URL and get both the rich tactical map AND the narrative compendium, with smooth bidirectional navigation.

**Recommended merge direction:** Port the compendium **INTO** `veydria-cartography`. Rationale:
- Cartography has 489 tests, CI, session tools, hex grid, journey planner — far more engineering investment
- React 19 vs React 18 is mostly backward-compatible for the compendium's patterns
- Leaflet + D3 overlay is more capable than the D3 SVG map for geographic interaction
- The cartography app already has InfoPanel, SearchBar, and layer architecture that can host compendium content

**Alternative (not recommended):** Enhance the worldbuilder map-viewer with cartography features. This would require re-implementing hex grid, journey planner, session tools, etc. in a codebase with no tests. Avoid unless the user explicitly requests it.

---

## Merge Technical Plan

### Phase 1: Data Bridge

The compendium depends on `canon.json` (188 narrative entities) and `search-index.json`. The cartography app currently has no access to these.

**Option A (recommended):** Generate a compendium data bundle as part of the cartography build pipeline.
- Add `design/narrative-schema/canon.json` and `search-index.json` to the sync script (`scripts/sync-world-data.mjs`) or copy them manually during build
- Place them in `web/public/` as static assets (like `veydria-spatial.geojson`)
- Fetch at runtime in the cartography app

**Option B:** Submodule or path reference. More complex, not worth it for static JSON.

### Phase 2: Compendium Component Port

Port the compendium components from the worldbuilder map-viewer into `veydria-cartography/web/src/components/compendium/`.

**Dependency check:**
| Worldbuilder dep | Cartography has it? | Action |
|---|---|---|
| `react` 18 → 19 | ✅ Yes (React 19) | Verify compatibility; likely fine |
| `marked` | ❌ No | Add to cartography `package.json` |
| `d3-selection`, `d3-zoom` | ✅ Partial (has `d3` full) | Use existing D3 imports |
| `js-yaml` | ❌ No (cartography uses GeoJSON) | Not needed if canon.json is pre-parsed |

**Components to port (roughly 1:1 copy, then adapt):**
```
web/src/components/compendium/
├── CompendiumView.tsx       (from CompendiumView.jsx — ~1150 lines)
├── EntityDetail.tsx         (from EntityDetail.jsx)
├── EgoNetwork.tsx           (from EgoNetwork.jsx)
├── CalendarCompare.tsx      (from CalendarCompare.jsx)
├── MatrixCardGrid.tsx       (from MatrixCardGrid.jsx)
├── CivilizationsView.tsx    (from CivilizationsView.jsx)
├── LensesView.tsx           (from LensesView.jsx)
├── GlobalOverview.tsx       (from GlobalOverview.jsx)
├── shared.ts                (from shared.js)
└── types.ts                 (new — define CanonEntity, Lens, etc.)
```

**Adaptations needed:**
- JSX → TSX (add types for canon entity shape)
- `canon.json` import → `fetch('/canon.json')` or static import
- `search-index.json` import → `fetch('/search-index.json')` (already async in worldbuilder)
- CSS: compendium uses `parchment.css` in worldbuilder. Cartography uses `App.css`. Either merge styles or scope compendium styles under a `.compendium` prefix.
- URL routing: cartography uses no hash router. Add hash-based route handling (`#compendium`) or a UI toggle (button in header) to switch between Map mode and Compendium mode.

### Phase 3: Map-Compendium Bridge in the Unified App

The existing bridge in worldbuilder goes: compendium entity → `#map?focus=kind:slug` → map zooms to feature.

In the unified app, this becomes:
- Compendium mode: click "Map" on an entity with `map_anchor`
- → Switch to Map mode + `flyTo` the location + open InfoPanel with entity context

The cartography app already has:
- `flyTo` via Leaflet (`map.flyTo()`)
- InfoPanel for feature details
- Layer toggle (`setLayers`)

What's needed:
- Extend `InfoPanel` or create a new `CompendiumInfoPanel` that can render a canon entity (markdown body, cross-refs, calendar events, etc.) alongside or instead of the GeoJSON feature data
- Map `map_anchor` kinds to cartography layer keys (cartography uses different layer names than worldbuilder)

### Phase 4: UI Integration

**Header:** Add a "Compendium" button next to the existing header buttons (Search, Journey, Measure, etc.). Clicking it switches the main view from Map to Compendium.

**Mobile:** The compendium was not designed for mobile (no media queries, no bottom sheet). The cartography app has `useMediaQuery`, bottom sheets, and player mode. The compendium will need responsive treatment.

---

## The Creative Pivot: Historically Grounded Tone

This is the **content** half of the mission. The user wants all narrative prose to feel like it was written by someone who has read real history — not generic fantasy filler.

### Where the content lives

**Worldbuilder repo** (`C:\Users\perry\DevProjects\worldbuilder`):
- `factions/` — civ factions, cross-civ relationships, dormant factions
- `magic/` — magic systems, registers, schools
- `religion/` — traditions, institutions, calendar institutions, schisms
- `timeline/` — historical events, epochs
- `ecology/` — biomes, flora, fauna
- `economy/` — resource governance, trade structures
- `linguistics/` — language families, culture languages
- `law/` — legal systems (new, actively being written)
- `geography/continents/veydria-topology.yaml` — feature descriptions, civ blurbs, trade route narratives

**188 entities** in `design/narrative-schema/canon.json` — these are the compendium entries.

### Suggested historical anchors

| Veydria element | Real-world parallel to draw from |
|---|---|
| Aethelian Basin (neutral trade pivot) | Adriatic Sea 15th c., Hanseatic League, Strait of Malacca |
| Six port cities, distinct architectures | Venetian-Genoese rivalry, Swahili city-states, Ottoman port system |
| Highland steppes north | Mongol successor states, Kazakh Khanates, Tibetan plateau polities |
| Southern oasis chains | Trans-Saharan trade, Silk Road oases (Samarkand, Kashgar) |
| Commodity roads (Copper-for-Steel) | Baltic amber, Sudanese gold routes, Anatolian iron wars |
| Mercantile wars (Harbor Oath, metal interdict) | Anglo-Dutch Wars, Opium Wars — but grounded in pre-industrial scarcity |
| Civ rivalries (Ngaru-Bon ↔ Irrah) | Byzantine-Sasanian competition, Ming-Timurid posturing |
| Sacred sites with dual claims | Jerusalem, Mount Kailash, Hajj routes |
| Chokepoints | Thermopylae, Khyber Pass, Danish Straits |
| Calendar institutions as political tools | Gregorian reform, Chinese calendar disputes, Islamic calendar schisms |
| Legal architectures | Roman law vs. customary law, sharia vs. qanun, English common law evolution |

### Voice compass (get this from the user before bulk-editing)

The user hasn't specified a single historian's voice yet. Options to propose:
- **Livy** — grand narrative, moral arc, founding myths
- **Ibn Khaldun** — cyclical rise/fall, asabiyya (group solidarity), desert vs. sedentary tension
- **Fernand Braudel** — material determinism, geography shapes possibility, longue durée
- **Amitav Ghosh** — trade-network humanism, merchant perspective, connected oceans
- **Thucydides** — cold power analysis, speeches as political logic, war as inevitable

**Recommend:** Start with a 200-word sample (e.g., rewrite the Aethelian Basin description or the Copper-for-Steel Road narrative) and iterate with the user on tone before touching all 188 entities.

### Workflow for the tone pivot

1. **Sample** (with user + Claude) — agree on voice via 1-2 rewrites
2. **Batch by category** — ports → civs → trade routes → magic systems → religious traditions → cross-civ matrices → calendar institutions → law docs
3. **Preserve gameability** — every description must still answer "what do the players see/do/feel here?"
4. **Update canon** — run `node scripts/extract-canon.mjs` after markdown changes to regenerate `canon.json` and `search-index.json`
5. **Validate** — `npm run validate` (worldbuilder) + `cd web && npm test -- --run` (cartography)
6. **Sync** — if geography YAML changed, run `node scripts/sync-world-data.mjs` to copy to cartography

---

## Critical Constraints

### Do NOT break
- `veydria-cartography` test suite (489 tests). The merge must either preserve all tests or update them.
- `worldbuilder` validation (`npm run validate` — 18 tests, `canon-canary` — 35 tests)
- `data/veydria-topology.yaml` sync protocol: worldbuilder is canonical, cartography is downstream

### Schema awareness
- Worldbuilder entities use YAML frontmatter with strict schema (`schema_version`, `type`, `family`, `civ_scope`, etc.)
- The `extract-canon.mjs` script reads frontmatter and body. Adding new frontmatter fields requires schema updates in `design/narrative-schema/schema/`
- `map_anchor` is already an accepted optional field (added 2026-05-14)

### Two-repo coordination
Changes will span both repos:
- **Worldbuilder:** narrative content rewrites, possibly new schema fields, canon regeneration
- **Cartography:** compendium component port, data pipeline update, UI integration, tests for new components

The user is running Claude for this session. Coordinate on file ownership — Claude may handle the content/rewrite layer while you handle the merge engineering, or vice versa.

---

## Current State Checklist

### veydria-cartography
```bash
cd C:\Users\perry\DevProjects\veydria-cartography
# Tests: 489/489 pass
cd web && npm test -- --run
# Build: green
cd web && npm run build
# Dev server: already running on localhost:5173 + 192.168.1.208:5173
```

### worldbuilder
```bash
cd C:\Users\perry\DevProjects\worldbuilder
# Validation: 18 passed
npm run validate
# Canon up to date
node scripts/extract-canon.mjs --check
# Canary: clean
node scripts/canon-canary.mjs
# Tests: 35 passed
node --test scripts/__tests__/canon-canary.test.mjs
# Map-viewer build: green
cd tools/map-viewer && npm run build
```

---

## Next Plausible Moves (Prioritized)

1. **Decide merge architecture** — User + Claude confirm: port compendium INTO cartography? Or other direction?
2. **Tone sample** — Rewrite 1-2 entity descriptions to nail the historically grounded voice.
3. **Component port** — Copy compendium components into cartography, add `marked` dependency, fix types.
4. **Data pipeline** — Add `canon.json` + `search-index.json` to cartography's build/sync.
5. **UI integration** — Header toggle, responsive layout, mobile treatment.
6. **Bridge wiring** — Map button in compendium → cartography `flyTo` + InfoPanel.
7. **Tests** — Add vitest tests for compendium components (worldbuilder has none; this is greenfield).
8. **Content batch rewrite** — Once voice is locked, rewrite entities by category.

---

## Files to Read First

| File | Why |
|---|---|
| `veydria-cartography/web/src/App.tsx` | Understand cartography's state architecture, routing, header |
| `veydria-cartography/web/src/components/InfoPanel.tsx` | See how feature details are rendered — compendium content may extend this |
| `worldbuilder/tools/map-viewer/src/App.jsx` | See hash routing, map/compendium toggle |
| `worldbuilder/tools/map-viewer/src/components/CompendiumView.jsx` | The compendium's main container — what you're porting |
| `worldbuilder/tools/map-viewer/src/components/compendium/EntityDetail.jsx` | Map button, entity rendering |
| `worldbuilder/design/narrative-schema/canon.json` (first 100 lines) | Entity shape |
| `worldbuilder/VEYDRIA-VISION.md` | Universe canon, tone baseline |
| `worldbuilder/HANDOFF-2026-05-14-master-session-close.md` | Latest worldbuilder state |
