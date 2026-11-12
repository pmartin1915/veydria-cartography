# Phase 2 spec: terrain constraints and validator (the contract)

Status: **draft 2026-11-11**, for review before implementation. Parent: `PLAN.md` Phase 2.
Canon read at worldbuilder `4b9a331`.

Phase 2 builds the test that Phase 3's terrain must pass. Nothing here generates terrain.
**Done** means three things:

1. `data/terrain-constraints.yaml` loads, and every ID in it resolves against the manifest and the
   derived geometry.
2. The validator has at least one passing and one failing fixture for every check.
3. The validator has run against two inputs, and both reports are committed:
   - the **canon mask** (A3), whose failures are canon or data issues for Perry, not terrain bugs;
   - the **prototype terrain**, whose report is the baseline Phase 3 must beat.

## A. Inputs

### A1. `scripts/derive-terrain-geometry.mjs` (new; generated file, never hand-edited)

This script writes `data/terrain-geometry.yaml` from `data/veydria-schematic.svg`, reusing
`derive-manifest.mjs`'s parser. Export `collectElements`, `matchBySignature` and `flattenPoints`
from that file; don't copy them. It supports `--check`, like `derive-manifest.mjs`. Add
`npm run derive:terrain-geometry` in `web/package.json`. A signature that matches the wrong count
is an error.

| Key | Signature (count) | What it is |
|---|---|---|
| `lines.kheshkai_wall` | `polyline`, stroke `#4a2e12`, width `3` (1) | The wall proper: monsoon face, 577,384 to 905,418 |
| `lines.kheshkai_east_margin` | `path`, stroke `#4a2e12`, width `1.2`, starts `M 905 418` (1) | Lower, drier margin over Irrah's SE lobe |
| `lines.ngaru_bon_west_escarpment` | `path`, stroke `#3a2e20`, width `1.1` (1) | The shelf's western scarp over Irrah's northern lobe |
| `lines.ngaru_bon_east_edge` | `path`, stroke `#5a4a35`, dasharray `5,2` (1) | Boundary with Kheshkai. Stored only; not a physical break |
| `lines.southern_rim_crest` | `polyline`, stroke `#6b4c2a`, width `1.4` (1) | The crest of the southern rim |
| `land.north_arm` | `path`, fill `#c4a862` (1) | The Basin's northern arm (Tavakh-Qarat's coast) |
| `land.southern_rim` | `polygon`, fill `#8b7355` (1) | The southern rim upland |
| `land.oravan_islands` | `path`, stroke `#3a7a3a` (8) | The eight islands, one ring each. The manifest only keeps their hull |
| `basin_mouth` | `line`, x1=x2=`283`, stroke `#d6ecfa`, dasharray `2,2` (1) | Cut line between Basin and ocean water |
| `latitude` | `line`, stroke `#fff`, dasharray `3,5` (7), paired top to bottom with the `NN N` labels | `y_px` to latitude, 34N at y=80 down to 10N at y=721 |

**The canon mask** is the union of: manifest civ polygons and `extra_polygons` (minus `oravan`,
which is a hull), `land.*`, and the eight island rings, minus the manifest `water.aethelian_basin`
polygon. Everything else in the frame is ocean. It is a **baseline, not an exact target**:
- Generated coasts may refine it within C8's tolerance.
- The terrain may extend the land into the `free_zones` declared in the constraints. These are the
  unmapped east edge (D7), where the canon mask asserts nothing.

### A2. `data/terrain-constraints.yaml` (authored)

Authored physics only. Points, rivers and routes are referenced by manifest ID and lines by
terrain-geometry key; **no coordinate is typed into this file** (Invariant 2). Every band carries a
`cite`. The sections are:

- **`meta`:** `km_per_unit: 4`, `sea_level_m: 0`, the worldbuilder commit read, and sources.
- **`defaults`:** `point_radius_u: 3`, `route_end_tol_u: 4`, `river_tol_u: 6`, `river_head_skip_u: 8`.
- **`water_bodies`:** `basin` is the manifest `aethelian_basin` polygon. `ocean` is all other water.
- **`regions`:** the spine's latitude and elevation bands per region. These are inputs for
  Phase 3.
- **`region_cores`:** the coarse relief test (C9). It runs on each region polygon **eroded by
  `erode_u`** (default 20), so political edges carry no weight (Invariant 3). Each core takes
  percentile bands, for example the Kheshkai interior `p50` in `[3000, 4800]`.
- **`free_zones`** and **`coast`:** the C8 parameters.
- **`points`:** one entry per manifest point:
  - `class`: one of `inland`, `land`, `coast`, `island`, `strait`, `shoal`;
  - class arguments (below);
  - optional `elevation_m: [lo, hi]` with `sample: any|median` (default `any`);
  - optional `radius_u`;
  - `cite`.
- **`lines`:** the hard features, as profile tests (C6).
- **`rivers`:** one entry per manifest river: `kind: convergent|distributary`, `terminus`,
  optional `min_area_km2`.
- **`routes`:** per manifest trade route and part: `mode: land|sea|river`, per vertex range where
  a route changes mode.
- **`unplaced`:** named physical features canon gives no position for (Ngon-Tso, Xal-Tzintla,
  Lha-Drak, the Iferis sabkha, the central erg). Each carries its canon relation, for example
  "between `tin_mashraq` and `qarat_al_fidda`". **None is checked in v1.** Each is a Perry
  question: place it upstream in worldbuilder `positions.yaml` `authored_places`, using the
  Phase 1 `review: true` precedent, or leave it to emerge.

## B. Raster contract (Phase 3 writes it, the validator reads it)

A terrain bundle is a directory holding:

- **`terrain.json`:**
  `{ "px_per_unit": int, "width_u": 1200, "height_u": 800, "sea_level_m": 0, "elevation": "elevation.npy", "seed": int, "generator": str, "constraints_sha256": str }`
- **`elevation.npy`:** float32 metres, shape `(800*ppu, 1200*ppu)`.
  - Pixel `(r, c)` has its centre at unit `((c+0.5)/ppu, (r+0.5)/ppu)`.
  - The frame is the schematic viewBox, with y pointing down (south).
  - **Water is `elevation < 0`, and nothing else is water.** Rivers, the ford and the seasonally
    flooded neck are land.

**Preflight.** The validator rejects a bundle before running any check when:
- `ppu` is not a positive integer;
- the shape is wrong for the frame and `ppu`;
- any value is non-finite.

A `constraints_sha256` that differs from the file in use is a WARN; it does not stop the run.

**Sampling.** A unit point `(x, y)` reads the pixel that contains it: `r = floor(y*ppu)`,
`c = floor(x*ppu)`, clamped to the frame. A disk includes every pixel whose centre lies within the
radius. A sample that falls outside the frame is skipped and counted in the report.

**Coarse grid (1 px/unit).**
- Elevation is the block mean.
- A coarse cell is water when **at least half its fine pixels are water**. Coarse water uses this
  majority rule, not the sign of the mean, so seabed depth cannot change it.
- Coarse land cells take `max(mean, 0.1)` and coarse water cells `min(mean, -0.1)`, so the two
  never disagree.

The 16-bit PNG and engine export formats are Phase 4. They are derived from this bundle.

## C. Checks (`generator/terrain/validate.py`)

**Command:**
`python -m generator.terrain.validate <bundle> [--constraints data/terrain-constraints.yaml] [--checks C1,C3] [--json out.json]`.

**Behaviour:**
- It reads YAML as UTF-8, prints a per-check table, and exits 1 on any FAIL.
- Results are PASS, FAIL or SKIP; SKIP always carries a reason.
- It needs only numpy, scipy, shapely and PyYAML; **no numba**.
- Point and route checks run at native resolution. Flow checks (C4, C5) run on the elevation
  **mean-pooled to 1 px/unit**. Pooling is a mean over the `ppu×ppu` block, and water at 1 px/unit
  is `pooled < 0`.

Basin versus ocean: a water pixel is **Basin** when its centre lies inside the manifest
`aethelian_basin` polygon, and **ocean** otherwise. Connectivity cannot separate the two, because
they join at Halkar.

**C1, point class**, inside a disk of `radius_u` (default 3) around the manifest point:

- **`inland`:** no water pixel in the disk.
- **`land`:** more than half of the disk is land.
- **`coast`:** the disk holds land and water. The water must be the stated `water: basin|ocean`
  (at least 80% of the disk's water pixels). The bearing from the point to the centroid of that
  water must lie within ±67.5° of `faces: N|NE|E|SE|S|SW|W|NW`.
- **`island`:**
  - The nearest land pixel within the disk belongs to a land component (8-connected) other than
    the largest, with area at most `max_area_u2` (default 2500).
  - `distinct_from: <id>`, where given, means that point's component must differ.
  - `caldera: true` adds a requirement: some water pixel within `radius_u` (default 4 for a
    caldera) has a ring of radius 1.5 units around it that is at least 70% land in that island's
    component. In other words, enclosed or near-enclosed water inside the island.
- **`strait`:** the point is water. Along `axis: NS|EW` through the point, the run of water
  pixels is bounded by land at both ends, with length in `[min_u, max_u]`. The point joins Basin
  water and ocean water through water (flood fill).
- **`shoal`:** at least one pixel in the disk has elevation in `[shoal_lo, shoal_hi]` (default
  `[-12, 8]` m). At least 75% of the ring at `radius_u` is water of the stated body.

**C2, point elevation band:** where `elevation_m` is set, the check passes if any pixel in the disk
falls in the band. With `sample: median`, the disk median must fall in the band instead. This is a
"band reached within r" test. It is not a one-pixel test, because at 4 km/px one pixel next to the
wall separates 50 m from 2,500 m.

**C3, routes:**
- A route takes one `mode`, or `parts: [...]` (one per manifest part), or
  `modes: [{vertices: [i, j], mode}]` (vertex ranges of a single path).
- Sample each part's polyline every `1/ppu` units. Drop samples within `route_end_tol_u` of the
  part's first and last vertex, of any vertex where the mode changes, and of any point named in
  `stops` (manifest point IDs: ports and waypoints).
- `land` and `river` parts: no sample on water.
- `sea` parts: no sample on land.
- Report each violating run as its start, end and length in units.

**C4, convergent rivers:**
- Fill depressions with a priority flood (heapq), with water pixels as outlets. Run D8 on the
  filled surface, breaking ties on flats toward the outlet by flood order. Then accumulate area in
  km².
- For each `kind: convergent` river:
  1. Snap its first vertex to the nearest coarse land cell. The manifest stores rivers upstream
     first, but that vertex is the **entry** of the drawn reach, not necessarily the headwater. The
     northern tributary's entry is A-Tzalan Ford at the wall foot.
  2. Trace D8 downstream to water or the frame edge.
- Pass when all of these hold:
  - every polyline sample beyond `river_head_skip_u` has a trace cell within `river_tol_u`;
  - the trace **passes through** its `terminus`, which is either `{disk: <point id>, r_u}` (the
    trace may continue beyond it) or `{water: basin|ocean, near: <id>, r_u}` (the trace ends in
    that water);
  - accumulated area is at least `entry_min_area_km2` at the entry, if set, which proves an
    upland catchment feeds it;
  - accumulated area is at least `min_area_km2` at the terminus, if set;
  - **fill depth:** along the trace, up to the terminus, the filled surface exceeds the raw
    elevation by at most `max_fill_m` (default 10). This catches a river certified across a
    barrier only by depression filling.
- Direction is implied: a trace that starts at the entry and still follows the line downhill is
  flowing the right way.

**C5, Ndjadi outlet and distributaries:**
- **(a) Drainage.** Take the core of the manifest `ndjadi` polygon, eroded by 6 units. Trace every
  core pixel by D8.
  - **Fail** if any trace ends in ocean water ("nothing south").
  - **Fail** if under 99% end in Basin water within `outlet_r_u` (default 90) of `ki_mbuhari`.
  - **Fail** if, of the core pixels south of `the_neck`, under 95% pass within `neck_r_u`
    (default 12) of `the_neck`.
- **(b) Distributaries** (`kind: distributary`). D8 converges, so it **cannot** show five mouths,
  and accumulation is not used here. Phase 3 must carve these channels explicitly. Sample each
  polyline from the apex to the mouth at native resolution.
  - The apex sample is at most 50 m.
  - **Total uphill:** the sum over all samples of `max(0, e[i] - min(e[0..i-1]))` is at most
    `max_uphill_m` (default 3). This total does not depend on resolution.
  - At least 80% of samples sit at least 0.5 m below **both** bank samples, taken `bank_u`
    (default 2) units to either side, perpendicular.
  - The mouth sample, or one within 1 unit of it, is Basin water.
- **(c) Connection.** The D8 trace from the coarse cell at `the_neck` ends in Basin water within
  `outlet_r_u` of `ki_mbuhari`, and its fill depth stays within `max_fill_m`. This links the trunk
  to the fan.

**Resolutions.** C5(a) and C5(c) run on the coarse grid. C5(b) runs at native resolution.

**C6, hard-line profiles:**
- **Stations.** For each `lines` entry, place stations every `station_u` (default 10) units along
  the polyline named by `geometry` (a `terrain-geometry.yaml` `lines` key; several entries may
  share one), restricted to `x_range` and `y_range` if given.
- **Sides.** At each station, take the two perpendiculars. The `toward: N|S|E|W` side is the one
  whose direction has a positive dot product with that compass vector.
- **Pass** when, at no less than `min_frac` (default 0.8) of the stations:
  - each `sides` test holds: the max (`stat: max`) or median elevation over `offset_u: [a, b]` falls
    in `elevation_m`;
  - the `on_line` test, if any, holds: `stat` over a 1-unit disk at the station falls in
    `elevation_m`;
  - the `water_within_u` test, if any, holds: walking the `toward` perpendicular from the station,
    water is found within `max_u`.

The `ndjadi_outlet` block in the constraints parameterises C5. It is not a check of its own.

**C8, water topology and coast**, at native resolution. The canon mask is A1's, rasterised at the
bundle's `ppu`.
- **(a) One Basin.**
  - Of the Basin-polygon water pixels, at least 95% lie in one 4-connected water component, the
    Basin.
  - The Basin's surface area is within ±`area_tol` (default 0.15) of the polygon's area.
- **(b) One mouth.** Remove all water inside the `mouth_cut` disk (`halkar_straits`, `r_u` from
  the constraints). The Basin component must then no longer connect to any water outside the
  Basin polygon. Before the removal it must connect (C1's strait check covers that).
- **(c) Coast agreement.** Exclude `free_zones` and a band `coast_band_u` (default 6) either side
  of the canon coastline. Then:
  - at least `min_agree` (default 0.97) of canon-land pixels are land;
  - at least `min_agree` of canon-water pixels are water.

**C9, region cores (coarse relief).** For each `region_cores` entry:
- erode the named manifest polygon (or `land.*` shape) by `erode_u`;
- optionally clip the core with `y_range` or `x_range`;
- compare the listed percentiles of land elevation inside the core with their bands.

It catches wrong terrain everywhere between the anchors: a Kheshkai with no high interior, a
crownless Ngaru-Bon, or a floodplain with hills in it.

## D. Fixtures and runs

- **`generator/terrain/tests/` (pytest).** One passing and one failing fixture per check, on small
  synthetic arrays with a synthetic manifest and constraints, so no file I/O is needed beyond
  `tmp_path`. Add `pytest` to `generator/requirements.txt`. CI does not run Python; the PR says so.
- **Canon self-check.** `generator/terrain/canon_mask.py` writes a bundle from A1's land/water
  union at 2 px/unit: land is +100 m and water is -50 m. Then run the validator with
  `--checks C1,C3,C6,C8` and commit the report as
  `research/map-hardening/PHASE2-CANON-REPORT.md`. In C6, only the `water_within_u` tests are
  meaningful on the canon mask; elevation tests there SKIP when the bundle declares
  `"relief": false` in `terrain.json`. C2, C4, C5 and C9 are not run.
- **Prototype baseline.**
  - Rebuild the prototype mask (prototype README steps).
  - Run `terrain_v3.py`, then wrap `elev.npy` (2 px/unit) as a bundle with
    `generator/terrain/bundle_from_prototype.py`.
  - Validate with all checks and commit the report as
    `research/map-hardening/PHASE2-PROTOTYPE-REPORT.md`. The npy files are not committed.

## E. Out of scope

Terrain synthesis, tiles, the biome raster and any web change are out of scope, and so is
placing the `unplaced` features.

Review: Sol (Codex, pmartin1913), 2026-11-11. The review raised 3 high and 5 medium findings, and
all were folded in:
- the rim distance is derived from the schematic;
- C8 adds the Basin and mouth topology and coast drift;
- C9 adds region cores;
- river entry versus source, plus fill depth;
- the uphill total and both banks for distributaries;
- raster preflight and sampling rules;
- the caldera test.
