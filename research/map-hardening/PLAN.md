# Map hardening: a Skyrim-grade relief map of the canonical continent

Started 2026-11-10. Owner: Perry. Boss: Claude (Opus). Status: **Phase 1 in progress (spec frozen 2026-11-11: PHASE1-SPEC.md).**

## Goal

Veydria's map should read like Skyrim's world map: real terrain with mountains, gorges, snow,
drainage and a desaturated earth palette, "without the atmosphere getting in the way" (no clouds,
fog, vignette or haze over the land). The interactive map, a printed poster and the engines all
use one terrain, so they match.

## Perry's decisions (2026-11-10)

| # | Decision |
|---|---|
| D1 | **Top-down relief now.** A tilted 3D "look at the world" mode built from the same heightmap is a future item (`ai/IDEAS.md`). Top-down keeps the hex grid, measuring and the journey planner working. |
| D2 | **Refine outlines.** The generator may add real coastlines, bays and island detail. (Given when we still assumed the April points stayed put; D5 supersedes the "points stay put" part. Named points now take their canonical positions.) |
| D3 | **Parchment stays as a toggle.** Relief becomes the default basemap. |
| D4 | **All three outputs:** the interactive web/desktop map, a static high-res poster, and a heightmap/biome export for the engines. "We want things to match." |
| D6 | **Palette B, "biome relief"** (2026-11-10): Skyrim's light and restraint, Veydria's climates legible but muted. Samples `samples/canon_B_biome*.jpg`. |
| D7 | **Terrain to the frame.** The schematic's "unmapped" north and east get plausible, unlabelled terrain to the edge; no fade or fog over land. |
| D5 | **Converge on the canonical layout now.** This supersedes the 2026-09-29 ruling that kept cartography on the April layout (worldbuilder `ai/IDEAS.md`). See the evidence in `GEOGRAPHY-AUDIT-2026-11-10.md`. |

Settled by canon precedence, not re-asked: the spine and schematic govern (worldbuilder
`geography/MAP-PROMPT.md` lines 33-40). That fixes the Halkar Straits as the Basin mouth, Qollari
and Kheshkai facing across the neck, and six Basin ports.

## What the prototype proved (research/map-hardening/prototype, samples/)

- A canon-driven heightmap at continental scale looks right when relief comes from **drainage**: a
  landscape-evolution model (priority-flood filling plus implicit stream-power incision, numba)
  cuts gorges into the Kheshkai wall and the Ngaru-Bon shelf. A 2400x1600 pass runs in about a minute.
- Three failure modes to design out:
  1. Particle-droplet erosion without depression filling pits the surface like a sponge
     (`samples/failed_v1_droplet_pits.jpg`).
  2. Isotropic noise gives blobby "puddle" plateaus instead of organised ranges.
  3. Biome colour and erodibility keyed to the schematic's region polygons show straight political
     edges in the terrain (the floodplain rectangle, the Irrah triangle in `samples/canon_*`).
- The renderer (multidirectional hillshade, two-scale ambient occlusion, slope-revealed rock, a
  noisy snowline, depth-ramped water, a thin coast line) already gives the Skyrim tonal read.

## Invariants

1. **One terrain source.** A single generated heightmap plus biome raster feeds the web tiles, the
   poster, the engine export **and the hex biome fills**. Nothing hand-paints a second version.
2. **Canon is upstream.** Constraints come from worldbuilder (the spine, the schematic,
   `tools/map-viewer/data/positions.yaml`, the location files), synced, never hand-copied. If the
   terrain disagrees with canon, the terrain is wrong.
3. **Physical regions emerge; political borders overlay.** The floodplain is wherever the land
   sits under about 50 m in the trough, not a polygon. Biome comes from latitude, rain shadow and
   elevation (the spine's latitude table). Civ borders are a separate vector layer.
4. **Canon rivers are constraints.** The north-flowing Ndjadi tributaries, the drain west along the
   wall then north through the neck, and the five distributaries fanning NW into the Basin at
   Ki-Mbuhari are seeded into the field and then validated. Emergent drainage fills in the rest.
5. **Labels and icons stay live vectors**, never baked into tiles (they must zoom, toggle and link).
6. **No atmosphere.** No cloud, fog, haze or vignette over land; the "unmapped" north and east edges
   are open question Q2.
7. **Procedural and reproducible.** Seeded; a canon edit re-runs the pipeline. No AI-image
   generation for the basemap (it cannot be registered to coordinates or regenerated). Skyrim is a
   style reference only: no assets, fonts or art taken from it.

## Phases

### Phase 1: converge cartography on the canonical layout (blocks everything else)

- Re-derive `data/coordinate-manifest.yaml` from worldbuilder `tools/map-viewer/data/positions.yaml`
  plus the schematic by script, not by hand. Keep feature IDs stable where the feature still exists.
  Add new canonical features: Tin-Aghiz, Morina, Arokar, the neck, the two lesser harbours, the
  western route and the Basin Hub route.
- Add cartography's stale `data/` copies (topology, MAP-PROMPT, schematic) to
  `scripts/sync-world-data.mjs`; replace `web/public/veydria-schematic.svg` (the live backdrop until
  Phase 4). Port what is worth keeping from the parked `map/port-ocean-to-redrawn-schematic`
  (98d6009). PR #54's data sync is already on origin/master.
- **Persisted-data inventory before merge.** Anything holding coordinates or axial hex keys: saved
  journeys, authored waypoints, campaign exports, fog-of-war explored hexes, hex deep links, share
  URLs. For each, decide migrate, invalidate or schema-bump. This is an active campaign's data, so
  **Perry signs off on any invalidation.**
- **Scale.** The canonical bar is 400 km per 100 units (4 km/unit). Grep every km-per-unit constant
  (`utils/measure.ts`, `utils/scale-control.ts`, `utils/world-coords.ts`, `utils/graticule-overlay.ts`,
  `utils/related-features.ts`, `JourneyRouteTab.tsx`). Path length in `utils/journey-graph.ts` (~234)
  is geometric.
- **Sim gate.** Capture baseline sim traces before, produce a before/after diff report after. Perry
  approves the moved numbers before merge. The unit suite and Playwright smoke stay green.
- Coordination: open branches touch the same surfaces (`fix/overlay-fractional-zoom-quantization`,
  `feat/player-view-rigor`, `feat/draggable-planner`). Land or rebase them first; the manifest port
  conflicts with anything that reads coordinates.

### Phase 2: terrain constraints + validator (the contract)

- `data/terrain-constraints.yaml` (synced canon in, authored physics out): per-region elevation bands
  from the spine table; hard features as geometry (the Kheshkai wall line and its east end, the
  Ngaru-Bon crown/shelf, the Lam-Chen notch, the southern rim with its steep seaward face, the
  neck, the Irrah escarpments, the sabkha, the erg, Ngon-Tso, Xal-Tzintla); canon rivers as
  polylines with flow direction; each named point's physical class from the audit table.
- `generator/terrain/validate.py`, the success criterion for Phase 3:
  - Every named point's land/coast/island/strait class and shore side matches the audit.
  - Each point sits in its elevation band.
  - Overland routes never cross water; sea routes never cross land.
  - Canon rivers follow flow accumulation in the right direction, ending where canon says.
  - Ndjadi drains through the neck to five mouths at Ki-Mbuhari, with nothing south.

### Phase 3: terrain synthesis

- `generator/terrain/` (Python, numba). Designed macro field from the constraints, then landscape
  evolution at 1 px/unit, upsample plus band-limited detail, a short fine pass at 4 px/unit (4800x3200,
  ~1 km/px). Anisotropic ridged noise aligned to range axes, not isotropic noise. Domain-warped coasts.
- Outputs: 16-bit heightmap, biome raster (latitude plus rain shadow plus elevation), flow raster,
  river vectors, coastline vectors. Seeded and deterministic.

### Phase 4: render, tile, integrate

- Renderer from the prototype (`render_v3.py`), in palette B (D6).
- Tiler: `generator/render/tiler.py` is a GDAL stub; slice XYZ tiles for Leaflet CRS.Simple with
  PIL. Set a max zoom and a tile-weight budget for GitHub Pages and the Tauri bundle (the 200 KiB
  gate covers JS only).
- `MapViewer.tsx` (~561): swap the `imageOverlay` for a tile layer in the same bounds; relief default,
  parchment toggle. Hex fills read the shared biome raster.
- Poster: labelled print render (replaces `output/veydria-map.png`).
- Engine export: heightmap, biome and flow rasters plus a manifest, published for engine-2d/3d.

### Phase 5: visual harness (part of done)

- Playwright screenshot spec at three zooms plus a resize, extending the e2e suite: hex and marginalia
  registration against the new basemap (`4921929` shows this broke before), labels upright, toggle
  works.
- `render-eyes`-style crops for review; a golden low-res render to catch regressions.

## Lanes

| Work | Lane |
|---|---|
| Phase 1 manifest port, sync map, scale constants | `/orchestrate` (Kimi), Opus reviews |
| Phase 1 persisted-data migration decisions | Opus plus Perry |
| Phase 2 constraints file | Opus (canon adjudication) |
| Phase 3 terrain-synthesis spec | Fable (the hard "what"), Sol reviews the spec |
| Phase 3 implementation | Opus or Kimi against the frozen spec |
| Phase 4 tiler, Leaflet swap, validator plumbing | `/orchestrate` (Kimi) |
| Diff review before each merge | Sol first, `reviewer` fallback |

## Open questions for Perry

- Q1 palette: decided (D6). Q2 unmapped edges: decided (D7).
- Q3 saved data: decided 2026-11-11 (PHASE1-SPEC.md, "Perry's decisions").
