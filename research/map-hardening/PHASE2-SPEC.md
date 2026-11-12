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

Land for any purpose here is the union of: manifest civ polygons and `extra_polygons` (minus
`oravan`, which is a hull), `land.*`, and the eight island rings, minus the manifest
`water.aethelian_basin` polygon. Everything else in the frame is ocean.

### A2. `data/terrain-constraints.yaml` (authored)

Authored physics only. Points, rivers and routes are referenced by manifest ID and lines by
terrain-geometry key; **no coordinate is typed into this file** (Invariant 2). Every band carries a
`cite`. The sections are:

- **`meta`:** `km_per_unit: 4`, `sea_level_m: 0`, the worldbuilder commit read, and sources.
- **`defaults`:** `point_radius_u: 3`, `route_end_tol_u: 4`, `river_tol_u: 6`, `river_head_skip_u: 8`.
- **`water_bodies`:** `basin` is the manifest `aethelian_basin` polygon. `ocean` is all other water.
- **`regions`:** the spine's latitude and elevation bands per region. These are **inputs for
  Phase 3**. They are not checked here, because physical regions must emerge rather than follow
  polygons (Invariant 3).
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
  1. Snap its first vertex (the manifest stores rivers source first) to the nearest land pixel.
  2. Trace D8 downstream to water or the frame edge.
- Pass when all three hold:
  - every polyline sample beyond `river_head_skip_u` has a trace pixel within `river_tol_u`;
  - the trace reaches its `terminus`: `{disk: <point id or [x,y] from geometry>, r_u}`, or
    `{water: basin|ocean, near: <id>, r_u}`;
  - the accumulated area at the terminus is at least `min_area_km2`, if set.
- Direction is implied: a trace that starts at the declared source and still follows the line
  downhill is flowing the right way.

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
  - Elevation is non-increasing, within 1 m slack, sample to sample.
  - At least 80% of samples sit at least 0.5 m below the mean of the two bank samples, taken
    `bank_u` (default 2) units to either side, perpendicular.
  - The mouth sample, or one within 1 unit of it, is Basin water.

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

**C7, the outlet block** (`ndjadi_outlet` in the constraints) parameterises C5(a); it is not a
separate check.

## D. Fixtures and runs

- **`generator/terrain/tests/` (pytest).** One passing and one failing fixture per check, on small
  synthetic arrays with a synthetic manifest and constraints, so no file I/O is needed beyond
  `tmp_path`. Add `pytest` to `generator/requirements.txt`. CI does not run Python; the PR says so.
- **Canon self-check.** `generator/terrain/canon_mask.py` writes a bundle from A1's land/water
  union at 2 px/unit: land is +100 m and water is -50 m. Then run the validator with
  `--checks C1,C3` and commit the report as `research/map-hardening/PHASE2-CANON-REPORT.md`.
  Classes that need relief (C2, C4 to C6) are SKIP by design.
- **Prototype baseline.**
  - Rebuild the prototype mask (prototype README steps).
  - Run `terrain_v3.py`, then wrap `elev.npy` (2 px/unit) as a bundle with
    `generator/terrain/bundle_from_prototype.py`.
  - Validate with all checks and commit the report as
    `research/map-hardening/PHASE2-PROTOTYPE-REPORT.md`. The npy files are not committed.

## E. Out of scope

Terrain synthesis, tiles, the biome raster and any web change are out of scope, and so is
placing the `unplaced` features. Region-band checks are left out on purpose (Invariant 3). The
hard-line profiles and point bands carry the elevation contract.
