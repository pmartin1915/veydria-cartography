# Phase 1 spec: converge cartography on the canonical layout

Frozen 2026-11-11 by the boss session (Opus). Implements PLAN.md Phase 1. Two executor tasks,
run in order: **P1a** (data, geometry, scale, sim report) then **P1b** (persisted-data migration).
Branch `feat/map-phase1-converge` off `origin/master` `bb76d8b`.

## Fixed inputs

- Worldbuilder `origin/master` `303d96f` (PR #396 added `authored_places` to
  `tools/map-viewer/data/positions.yaml`). Run the sync with `WORLDBUILDER_PATH` pointing at a
  clean checkout of that commit, never at a dirty working tree.
- Canonical schematic `geography/veydria-schematic.svg` (2026-09-29), 1200x800 viewBox, the same
  coordinate frame the manifest already uses. positions.yaml stores normalized coordinates:
  multiply x by 1200 and y by 800.
- Baseline sim: `traces/pre-phase1/summary.csv`, captured at `bb76d8b` with
  `npm --prefix web run sim:batch` run from Git Bash with no filters (30 civ pairs, 4320 runs).
  This is deterministic: two runs were byte-identical. Run the after-pass the same way.
  Under PowerShell, npm drops the arguments after `--`, so use Git Bash.

## Perry's decisions (2026-11-11, Q3 of PLAN.md)

1. Saved pins that are linked to a feature move with that feature. Unlinked pins stay where they are and get flagged.
2. Explored fog hexes reset. Keep a backup copy.
3. Old links and campaign files: version them. New links and exports carry a layout tag. In an old link, `cx`/`cy`/`z` fall back to the default view. Old campaign files import through a v1→v2 migration. Old edit-mode patches are refused.
4. Saved journeys recompute km and days on the new map. A stored total is never shown as current.

---

## P1a: data, geometry, scale

### A1. Sync

- Add `{ src: 'tools/map-viewer/data/positions.yaml', dest: 'data/positions.yaml' }` to
  `SYNC_MAP` in `scripts/sync-world-data.mjs`. It is required, not optional.
- Run the sync. Topology, MAP-PROMPT, canon and the others refresh, and topology gains
  `aethelian_basin_hub`. `node scripts/sync-world-data.mjs --check` must report everything up to date.
- Replace `web/public/veydria-schematic.svg` with the version from parked commit `98d6009`
  (`git checkout 98d6009 -- web/public/veydria-schematic.svg`). That commit is the canonical
  schematic plus the #23 ocean. If `data/veydria-schematic.svg` changed after `98d6009`'s base,
  stop and report rather than merge by hand.

### A2. `scripts/derive-manifest.mjs` (new)

Node, ESM. Resolve `js-yaml`/`yaml` from `web/node_modules` the way `sync-world-data.mjs` does.
It reads `data/positions.yaml`, `data/veydria-schematic.svg` and the current
`data/coordinate-manifest.yaml`, and writes `data/coordinate-manifest.yaml`. Requirements:

- Deterministic output. Round coordinates to 0.1.
- `--check` exits 1 if the output would differ.
- Add `npm run derive:manifest` in `web/package.json`.
- Add the derive `--check` to `scripts/check-data.mjs`.

**Carry-over rule.** Geometry (`coords`, `polygon`, `path`, `centroid`) comes from canon. Every
other field on an existing entry is kept verbatim, matched by manifest ID: names, descriptions,
etymology, colours, symbols, `civ`, `category`, `no_intra_civ` and `style`. Update `metadata`:
- `version` becomes `2.0.0`.
- `last_updated` is the run date only when the derived content (everything except
  `last_updated`) changed. Otherwise keep the existing value, so `--check` stays stable across days.
- Add `layout: canon-2026-09-29`.
- Replace `note` with a sentence that names the derive script.

Keep the header comment, rewritten to say the file is generated.

**Section and ID map.** Write this as an explicit table in the script, not as a string
transform. A positions slug maps to a manifest ID by changing `-` to `_`, except where listed:

| Manifest entry | Source |
|---|---|
| `ports.{ki_mbuhari,tavakh_qarat,halani_tamu,dzong_tamu}` | positions `ports.*` |
| `chokepoints.*` (6) | positions `chokepoints.*` |
| `oases.{qarat_al_fidda,ghadam_thalla,tin_mashraq,khulut,zin_iferis}` | positions `oases.*` |
| `oases.ayn_salqat` | **REMOVED.** Canon says it has no marker. List it in the script's `REMOVED_IDS`. |
| `contested_sites.{qhabal_ur,veyd_kirrha}` | positions `sacred_sites.*` |
| `landmarks` `zang_ri`, `apu_yana`, `volata_xal` | positions `mountains.*` |
| `landmarks` `halkar_port` | positions `authored_places.places.halkar`. **The ID stays `halkar_port`.** |
| `landmarks` `kha_tepet`, `ki_jenga`, `hassag_nganin`, `wasi_puma`, `first_caldera`, `kelata` | `authored_places.places.*` (`kind: landmark:<type>`) |
| `landmarks` **new**: `morina`, `arokar`, `the_neck` | `authored_places.places.*`. Name from the slug in title case ("The Neck"). `type` comes from the kind suffix. Colour and symbol match the existing landmarks. Descriptions: Morina "Northernmost island of the Oravan chain."; Arokar "Southernmost island of the Oravan chain."; the_neck "The lowland gap between Qollari's north-east foothills and the west end of Kheshkai's wall, where the Ndjadi drains north to the Basin." |
| `waystations` `tavakh_rubat`, `kelata_tamu`, `wasi_pukya`, `dzong_kha`, `tepet_apu`, `kalli_xal`, `zang_kalli`, `rubat_al_darb` | `authored_places.places.*` (`kind: waystation:<category>`) |
| `waystations` **new**: `tin_aghiz` | `authored_places.places.tin-aghiz`. `category: port`, `civ: irrah`. Name "Tin-Aghiz", description "Frankincense port on Irrah's south-east coast, the southern terminus of the frankincense crossing.", plus the port styling of `tavakh_rubat` |
| `civilizations.<civ>.centroid` | positions `regions.<slug>.label_anchor` |

Ignore any `authored_places` row with `kind: route-point` (halanimoa); it is only used by routes.
Any old manifest ID that is not in the output and not in `REMOVED_IDS` is a script error.

**Shapes from the schematic.** The schematic has no element IDs, so match each element by its
style signature. Signatures are exact attribute values. They match only `<path>`, `<polygon>` and
`<polyline>` elements, never `<line>`, because the legend draws route samples as `<line>`s with the
same styles (Sol review, 2026-11-11). Flatten every cubic `C` into 8 segments.
`M`, `L`, `C`, `Z` and `<polyline points>` are the only commands in play. A signature that
matches zero elements, or more elements than listed, is a script error.

| Manifest entry | Element signature (match count) | Notes |
|---|---|---|
| `civilizations.ngaru_bon.polygon` | `path fill="url(#crown)"` (1) | |
| `civilizations.kheshkai.polygon` | `path fill="#a8b86a"` (1) | |
| `civilizations.irrah.polygon` + `extra_polygons` | `polygon fill="#d4a854"` (1) for the north lobe; `path fill="#dcc584"` (1) for the SE lobe, written as `extra_polygons: [[...]]` | |
| `civilizations.ndjadi.polygon` | `path fill="#3a8a3a"` with no stroke (1) | |
| `civilizations.qollari.polygon` | `path fill="#2d6b3f"` (1) | |
| `civilizations.oravan.polygon` | convex hull of the 8 `path stroke="#3a7a3a"` island outlines, closed | |
| `water.aethelian_basin.polygon` | `path fill="#3a7ca5"` (1) | |
| `rivers.ndjadi_tributary_north` | `path stroke="#4a8ab0" stroke-width="1.4"` starting `M 700 405` | from A-Tzalan |
| `rivers.ndjadi_tributary_west` | the same stroke, starting `M 468 505` | off Qollari |
| `rivers.ndjadi_tributary_qollari_south` **new** | the same stroke, starting `M 520 592` | |
| `rivers.ndjadi_trunk_east` **new** | the same stroke, starting `M 800 592` | |
| `rivers.ndjadi_tributary_wall_east` **new** | the same stroke, starting `M 830 413` | |
| `rivers.ndjadi_dist_1..5` | `path stroke="#4a8ab0" stroke-width="1.3"` (5), numbered by end x ascending (west to east) | |
| `trade_routes.copper_for_steel_road.path` | `stroke="#8b5e3c" stroke-dasharray="4,3"` (1) | |
| `trade_routes.highland_steppe_corridor.path` | `stroke="#d4a017" stroke-dasharray="6,4"` (2), joined at the shared vertex (860,260) into one path | |
| `trade_routes.highland_relay` | `stroke="#3a8a3a" stroke-dasharray="3,5"` (2): main `M 350 625`, branch `M 485 344` | multi-part |
| `trade_routes.coastal_monsoon.path` | `stroke="#4a8ab0" stroke-dasharray="8,2,2,2"` (1) | |
| `trade_routes.aethelian_basin_hub` **new** | `stroke="#fff" stroke-dasharray="3,3"` (2): the closed ring (close it back to its first vertex) plus the Ki-Mbuhari spur | multi-part. Style is color `#ffffff`, dash `3,3`, label "Aethelian Basin Hub" |
| `trade_routes.caravan_thread` | `stroke="#d4a854" stroke-dasharray="3,4"` (5), plus `stroke="#d4a854" stroke-dasharray="1,3"` (1, the frankincense crossing) | multi-part, 6 parts |
| `trade_routes.scribal_ladder.path` | straight segments through `authored_places.routes.scribal-ladder.stops` | |
| `trade_routes.western_route.path` | straight segments through `authored_places.routes.western-route.stops`. `off-map-west@262` is `[0, 262]`. Keep the existing `off_map_terminus` handling. | |

A stop slug resolves through positions sections, then `authored_places.places`. Multi-part
routes are written as `paths: [[...], [...]]` in place of `path:`.

### A3. Exporter and graph: multi-part routes and two-part regions

- `generator/export/geojson.py` emits each part of a multi-part route as its own LineString
  feature. Part 1 keeps the route ID. Parts 2+ get ID `<route>__p<n>`. Every part carries
  `properties.route_id = <route>` and `properties.part = n`, plus the same lore and style.
- **Graph contract for parts.** Changing `journey-graph.ts` is authorized for this purpose only.
  Coordinate coincidence does not join anything today: each node snaps to one best route, and the
  parent's endpoint list is anchored onto each part. So:
  - `derive-manifest.mjs` writes `part_endpoints: [[idA, idB], ...]` beside `paths`, one pair per
    part. For each of a part's first and last vertex, the ID is the nearest point feature within
    20 units. If there is none, it is the civilization whose polygon contains the vertex (for
    example the Relay main leg's south end, inside Qollari). If neither exists, it is a script
    error. A closed ring has the same ID at both ends. Expected results, which the derive test
    asserts: the Basin Hub spur ends at `the_neck`, the Relay branch starts at `ki_mbuhari`, and
    the caravan parts and frankincense crossing end exactly on their oases, Khulut and Tin-Aghiz.
  - An endpoint feature that is not already a graph node (for example the landmark `the_neck`)
    is added as a node.
  - The exporter copies each pair onto its part as `properties.endpoints`. A part never inherits
    the parent route's civilization endpoints.
  - In the graph, a part's edges run only between nodes on that part: its two endpoint nodes plus
    nodes snapped along it. Nodes that lie within `SNAP_THRESHOLD_SVG` of several parts (junction
    oases and ports) attach to every one of those parts, not just the best one. This multi-attach
    applies only to features with `route_id`. Single-path routes keep today's one-best-route
    behaviour.
  - A parent route's civilization endpoints, where topology gives them, attach only to the part
    whose endpoint feature belongs to that civilization.
- A civilization with `extra_polygons` is emitted as a MultiPolygon, and its centroid stays the
  manifest `centroid`.
- Every consumer that keys on a route's ID (info panel, route highlight, layer toggles, topology
  lore lookup, journey-graph route names and authored-day lookup, sim, exports) must resolve
  `route_id` when present. Every consumer of civilization geometry must accept MultiPolygon: the
  `journey-graph.ts` centroid fallback, hit-testing, drawing, and the generator renderer.
  Grep for `geometry.type` across `web/src`, `scripts/` and `generator/`.
- Do not change routing semantics beyond that.
- Regenerate `web/public/veydria-spatial.geojson` with the generator export and commit it.
  `generator/pipeline.py validate` must pass. If validate rejects `aethelian_basin_hub` or the
  new features, fix the validator to accept canon. Never edit synced canon.

### A4. Scale: 4 km per unit

- `web/src/utils/world-coords.ts` sets `kmPerSvgUnit` to 4 (the 1200-unit width is 4800 km).
  Update its header comment, `measure.ts:4`, `travel-time.ts:4` and `travel-time.ts:18`.
- `related-features.ts:140` imports `worldScale` instead of the hard-coded 2.5.
- `annotations.ts:20` `FEATURE_LINK_MAX_DISTANCE` keeps its km meaning: 25 units (100 km).
  Update its comment.
- `journey-graph.ts:233` `SNAP_THRESHOLD_SVG` stays 10 units, because it measures drawing
  precision. Fix the stale km comments (10 units is 40 km).
- `generator/render/rasterize.py:401,410`: the scale bar becomes 100 units labelled "400 km".
- Update `measure.test.ts` and `world-coords.test.ts`.
- No other speed or day constant changes. Authored canon day counts still win, per `journey-days.ts`.

### A5. April position table (input for P1b)

`scripts/capture-april-layout.mjs` reads the manifest from `git show bb76d8b:data/coordinate-manifest.yaml`
and writes `web/src/generated/layout-april-positions.json`, then commit it. The output has two
maps:
- `points`: `{ id: [x, y] }` for point features;
- `centroids`: `{ id: [x, y] }` for civilization and water polygons.

Routes and rivers are not captured. P1b uses the file to re-anchor pins.

### A6. Acceptance (P1a)

1. `npm test` (web), `tsc -b`, `npm run build`, `npm run check:size`, `npm run check:data`
   (sync `--check`, topology validate, derive `--check`) and `npm run test:e2e` all pass.
   Update an e2e or unit assertion only where it pins an April coordinate or the 2.5 scale, and
   list each one in the report.
2. New `scripts/derive-manifest.test.mjs` (node `--test`, or vitest if simpler):
   - running it twice gives identical output;
   - every signature matches its listed count;
   - every old ID is present or in `REMOVED_IDS`;
   - every feature lies inside the 1200x800 frame;
   - ports, waystations and oases sit within 1 unit of the positions value.
3. New graph-integrity test on the regenerated geojson (`web/src/utils/journey-graph.integrity.test.ts`):
   - every port, oasis and waystation is connected to at least one trade-route edge;
   - every pair of the six civilization nodes has a route in all four modes;
   - named traversals exist and visit these nodes in order, along trade-route edges whose
     geometric length is within 2% of the summed part geometry:
     - Halani-Tamu → Qarat al-Fidda → Ghadam-Thalla, and Qarat al-Fidda → Zin-Iferis → Smith-Spring;
     - Tin Mashraq → Qarat al-Fidda → Halani-Tamu;
     - Khulut → Rubat al-Darb → Tin-Aghiz, along the frankincense crossing;
     - Tavakh-Qarat → Halani-Tamu → Dzong-Tamu → Ki-Mbuhari around the Basin ring, plus the
       Ki-Mbuhari → the-neck spur, if the neck is a node;
     - the Highland Relay main leg through Wasi-Pukya, and its branch toward Veyd-Kirrha;
     - Kalli-Xal → Breath-of-Cloud → Tepet-Apu on the corridor;
   - no trade-route edge joins two civilization centroids directly, and no part has an edge to a
     node outside its own endpoints and snapped nodes;
   - `western_route` stays display-only (no edges), as today.
4. Sim after-pass, run the same way as the baseline. Both stages use the final code and the
   final geojson. The only difference between them is `kmPerSvgUnit`, set temporarily to 2.5 for
   stage 1 and not committed.
   - Stage 1 is the new manifest at the old 2.5 scale: `traces/post-phase1-stage1/summary.csv`.
   - Stage 2 is the new manifest at 4 km/unit: `traces/post-phase1/summary.csv`.
   - Each run must produce the same 4320 input tuples as the baseline (from, to, season, mode,
     party, supply).
5. New `scripts/sim/compare-summaries.mjs` writes `research/map-hardening/PHASE1-SIM-REPORT.md`.
   - The header records the commit, a sha256 of the geojson and the exact command for each run.
   - Per civ pair and per mode, show the median `total_km`, the median `estimated_days` and the
     completion rate for baseline, stage 1 and stage 2.
   - Show an overall table per mode and per season.
   - Compare `route_found` per full input tuple. List every tuple found at baseline and not
     after. Count the `error` column separately from non-completion.
   - Keep the prose plain: tables and one-line notes.
6. Commit `summary.csv` files only. `traces/**/traces.jsonl` is gitignored (add the rule).

## P1b: persisted-data migration (after P1a lands on the branch)

All of this lives in `web/src`. Put a shared constant `MAP_LAYOUT = 'canon-2026-09-29'` in
`world-coords.ts`.

1. **One-time local migration.** Run it after kvStore hydration completes and the geojson and
   journey graph are loaded, and before the first render that reads annotations or journeys. It
   is guarded by the kv key `veydria.mapLayout.v1`. If that key is absent and any kv data exists:
   - first normalize the legacy keys (annotations v1 → v2, `veydria-journey-history` →
     `veydria.journeys.v1`) through the existing migration code, so that nothing converts lazily
     after this step;
   - if no backup exists, write `veydria-annotations-v2.backup-april` and
     `veydria.journeys.v1.backup-april`, then read them back and compare. If the read-back fails,
     abort the migration, leave the data untouched, and do not write the marker;
   - always compute the migrated values from the **backup** copies, never from the live keys, so
     that a re-run after an interrupted migration cannot translate a pin twice;
   - move every pin whose `featureId` is in `layout-april-positions.json` (`points` or
     `centroids`) and in the current geojson by (new position − April position);
   - set `needsReview: true` on every other pin, including pins linked to a route or river, and
     show "Placed on the old map: check its position" in the pin's popup;
   - remove every `kind: 'explored'` record (its copy stays in the backup);
   - recompute `totalKm`, `estimatedDays`, `edgeCount` and `bottlenecks` for each saved journey
     in `veydria.journeys.v1` through the current graph. A journey whose node IDs no longer
     resolve keeps its stops, gets `stale: true`, and the list shows "Route needs replanning";
   - write the migrated annotations and journeys, read them back to verify, and only then write
     `veydria.mapLayout.v1 = MAP_LAYOUT`. On Tauri, await the kvStore flush before writing the
     marker.
   On a fresh profile with no kv data, only write the key.
2. **URL hash.** `buildHash` writes `layout=<MAP_LAYOUT>`. When `parseHash` sees `cx`, `cy` or
   `z` without the current `layout`, it drops them, so the default view applies. All other
   params are kept.
3. **Campaign export.** Raise the export to `version: 2` with `layout: MAP_LAYOUT`. On import,
   `version: 1` runs the same transform as step 1 on the imported content, then saves it. 2 is
   accepted. Any other version still throws.
4. **Edit-mode patch.** The export writes `metadata.layout: MAP_LAYOUT`. On import, a patch
   without the current layout is refused with a visible message ("This patch was made on the
   old map layout and cannot be applied") and applies nothing.
5. **Tests.** Cover the migration:
   - linked pin moved, unlinked pin flagged, explored removed, backup written, journey
     recomputed, unknown node marked stale;
   - second run a no-op;
   - a re-run after an interrupted migration (backup present, marker absent) yields the same
     result as one clean run;
   - a backup write failure aborts with the data untouched.

   Also cover the
   hash with and without `layout`, the campaign v1→v2 import and v3 rejection, and patch
   refusal. All the existing gates from A6.1 stay green.

## Out of scope

Terrain, tiles, the relief basemap, biome raster, hex fill changes, the 3D view and the
worldbuilder travel graph's April `display` coordinates (a separate worldbuilder item). Merging
`feat/draggable-planner` is also out.

## Review gate before merge

Sol reviews the P1a+P1b diff, with `reviewer` as the fallback. Perry approves the moved numbers
in `PHASE1-SIM-REPORT.md` and the seven `review: true` placements in worldbuilder #396.
