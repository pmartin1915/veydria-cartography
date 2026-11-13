# Phase 3 spec: terrain synthesis

Status: **frozen 2026-11-12** (Fable; three Sol review rounds, see section 14). Parent: `PLAN.md` Phase 3.
Contract: `PHASE2-SPEC.md` (frozen), `data/terrain-constraints.yaml`, `generator/terrain/validate.py`.
Canon read at worldbuilder `0b35f36`.

Phase 3 builds the one terrain that the web map, the poster and the engines all read. This spec
says what to build and how each requirement is met. It does not contain the code.

## 1. Done

All of these hold for the default seed at 4 px/unit:

1. `python -m generator.terrain.validate <bundle>` reports **zero FAIL and zero SKIP** over C1 to C9.
2. The feature checks in section 9 (K1 to K12) all pass. They cover what the validator does not:
   the five placed features, the closed basins, the pit and determinism gates.
3. Two builds from the same seed on the same machine give byte-identical `elevation.npy`.
4. A full build takes under 15 minutes on the laptop, and `--ppu 2` under 4 minutes.
5. Perry has looked at the preview render (section 10) and said the land reads right.

Items 1 to 4 are machine-checked by one command, `python -m generator.terrain.build --check`.

## 2. The governing idea: construct, do not repair

The prototype was a look test. It warped the coast freely, seeded no rivers and trusted erosion to
find the canon drainage, and it failed 52 checks. Tuning noise until 126 checks happen to pass is
not a plan.

So every check is met **by construction**, at a named stage, by a mechanism that cannot miss:

- A coast that may only move where nothing is protected.
- A floodplain whose surface is a distance field, so it has no pits and one outlet by arithmetic.
- Canon rivers that are fixed cells with fixed receivers, so erosion grades the uplands to them.
- A fine raster that pools back to the coarse raster, by the validator's own pooling rule, wherever
  the validator routes flow.

Each stage ends with a **gate**: an assertion that fails the build and names the stage. Erosion and
noise supply the look. They are never relied on to satisfy a constraint.

**The validator is the judge of every gate.** The validator never reads the generator's receiver
table or masks. It rebuilds everything from `elevation.npy`: it pools to 1 px/unit (a block is water
when at least half its pixels are negative; its elevation is the block mean, clamped to at least
0.1 m on land and at most -0.1 m on water), floods, and sends each cell to its **lowest** neighbour.
So a gate never trusts the generator's own bookkeeping. It imports the validator's functions
(`Context.coarse`, `_priority_flood`, `_d8_downstream`, `_nearest_land_cell`, the check functions)
and runs them on the raster as it stands. "The coarse grid" below always means the validator's
pooling.

Two guarantees are proven by arithmetic (protected pixels keep their class; the floodplain has no
pits). The rest are designed with margin and then gated. Section 8 says which is which.

Section 8 maps every check to its mechanism.

## 3. Layout

```
generator/terrain/
  build.py        CLI and stage runner            params.py     loads data/terrain-params.yaml
  protect.py      S1 protection sets              mask.py       S2 land mask and coastline
  provinces.py    S3 provinces and macro field    hydro.py      S4 skeleton, S5 floodplain surface
  climate.py      S6 and S11 rain, S11 biome      lem.py        S7 and S8 erosion (from the prototype)
  detail.py       S8 upsample and fine detail     features.py   S9 stamps and carves
  bathy.py        S10 sea floor                   vectors.py    S12 rivers, coast, lakes
  feature_checks.py  K1 to K12                    noise.py      seeded spectral noise
```

- `validate.py`, `canon.py` and the constraints file are **frozen**. If a check proves wrong, stop
  and write it up for Perry. Do not edit the contract to make terrain pass.
- `data/terrain-params.yaml` (new, authored) holds every tunable number in this spec. It holds no
  coordinates. Every feature position comes from the manifest or `terrain-geometry.yaml`.
- Dependencies: numpy, scipy, shapely, PyYAML, numba. Add `numba` to `generator/requirements.txt`.
- Command: `python -m generator.terrain.build <outdir> [--seed N] [--ppu 4] [--until S7] [--check]`.
  `--until` stops after a stage and writes that stage's rasters for inspection.
- Bundles go to `output/terrain/<seed>/`, which is gitignored. No `.npy` is committed.

## 4. Grids, noise and determinism

- **Coarse grid:** 1 px/unit, 1200 x 800. **Fine grid:** 4 px/unit, 4800 x 3200, about 1 km per pixel.
  Pixel centres follow PHASE2-SPEC section B.
- **Noise** is spectral (FFT-filtered white noise, as in the prototype). Every field is generated on
  the coarse grid and upsampled, so the coarse and fine stages see the same field.
  - The seed of a field is the first 8 bytes of `sha256(f"{master_seed}:{field_name}")`. Never use
    Python's `hash()`.
  - **Anisotropic** fields scale the wavenumber by 3:1 along a grain angle before filtering. Fields
    for different grains are blended by province weight (S3).
- **Determinism:** no `fastmath`, no `parallel=True` in numba, stable sorts only, float64 inside
  stages and float32 only on write. `terrain.json` records `content_sha256` of `elevation.npy`.
  Byte equality is promised on one machine, not across machines.

## 5. Stages

Each stage lists what it makes, the rule it obeys and its gate.

### S1. Protection sets (`protect.py`)

Rasterised at fine resolution from the manifest and the constraints. Nothing else in the build may
change the class of a protected pixel.

**Must be land (`P_land`):**

| Source | Shape |
|---|---|
| `inland` points | disk of `radius_u + 1` |
| `land` points | disk of `radius_u` |
| `land` and `river` route parts | corridor of half-width 1.5 u along the samples C3 keeps |
| Canon rivers, convergent and distributary | corridor of half-width 3 u (covers `bank_u`), less every mouth reservation below. Within 4 u of a distributary mouth the corridor is clipped to canon land, because the mouth vertex lies in canon water (amended in M1) |
| `the_neck` | disk of 12 u |
| `island` points | disk of 1.5 u at the pin; for `caldera: true`, a ring from 1.7 u to 3 u instead |
| `coast` points | one **land witness**: a disk of 0.75 u (below) |

**Must be water (`P_water`):**

| Source | Shape |
|---|---|
| `sea` route parts | exactly the pixels holding the samples C3 keeps; plus a corridor of half-width 1.5 u around them. The corridor, and every other optional buffer or dilation in this table, is **clipped to the Basin polygon** wherever its water joins the Basin outside the `mouth_cut` disk. A kept sample pixel that itself lies outside the polygon there is a canon conflict: stop |
| `strait` point | disk of 2 u |
| `shoal` points | ring from `radius_u - 0.5` to `radius_u + 1.5` |
| `coast` points | one **water witness**: a disk of 0.75 u (below), clipped to the Basin polygon for `water: basin` |
| Each distributary mouth | disk of 1 u, clipped to the Basin polygon |
| The caldera pool and breach, and the Kelata tidal channel | see S9 |

**Coast witnesses.** C1 asks a coast disk for some land, some water of the right body, and a water
centroid on the right bearing. It does not ask for half-disks. For each coast point, place the water
witness at the canon-water pixel nearest the pin along the `faces` bearing, and the land witness at
the canon-land pixel nearest the pin on the opposite side, both inside the point's disk. If a
witness would fall within 1.5 u of a kept sample of the other class, slide it along the canon shore
until it does not.

**Precedence.** Where two sources overlap by construction, the order is fixed: kept route samples
first, then mouth reservations and the caldera pool, then witnesses, then corridors, disks and
rings. A lower source is trimmed by a higher one.

**Gate S1:** after trimming, `P_land` and `P_water` do not intersect. An overlap that survives
trimming is a canon conflict: print the two sources and stop.

### S2. Land mask and coastline (`mask.py`)

1. **Base mask.** Start from the canon mask (`canon.canon_land_geometry`, PHASE2-SPEC A1), rasterised
   at fine resolution. Add `P_land`, then remove `P_water`. This is what closes the ocean wedge's
   tip at the neck (the Highland Relay's land corridor) and adds the Kelata-Tamu islet (Q4).
2. **Halkar throat.** The schematic draws a mouth 25 u wide; the location file says "half a march
   wide at its narrowest". Both hold if the mouth is a funnel. Session reading. Exact footprint:
   let `(px, py)` be the strait pin. For `|x - px| <= 20`, the allowed water half-width is
   `w(x) = t/2 + (W(x)/2 - t/2) * smooth(|x - px| / 20)`, with `t = strait_throat_u` (5 u) and
   `W(x)` the canon mouth's north-south width at that `x`. Canon water with `|y - py| > w(x)`
   becomes land, unless it is in `P_water`. Nothing east of `px + 20` changes, so Tavakh-Rubat's
   ring (30 u east) is untouched. The added land is about 300 u², far inside C8c's 3% allowance.
3. **Free zone (D7).** Inside `free_zones`, land continues to the frame: extend each coastline that
   enters the zone along its last heading, and fill the landward side.
4. **Bounded coastline noise.** Let `d` be the signed distance to the base coast in units, positive
   on land. The final mask is `d + n > 0`, where `n` is noise with `|n| <= a` at every pixel and
   `a` is an amplitude field:
   - `a = min(a_max, 0.5 * dist_to(P_land or P_water))`, with `a_max = 4 u`. So `a = 0` on protected
     pixels, and because `d` cannot change faster than 1 per unit, a protected pixel keeps its class.
   - **Basin shore is one-sided.** C8b counts any Basin water outside the Basin polygon as a leak,
     so within 10 u of the Basin polygon's edge, outside the `mouth_cut` disk, `n` is clamped to
     `n >= 0`: the land may advance into the polygon and never retreat from it.
   - **Delta front.** Within 20 u of any distributary mouth, `a = 0`. The front is the base mask.
   - `n` is two octaves: wavelength 40 to 120 u at full amplitude and 6 to 20 u at one quarter.
5. **Topology cleanup,** all 4-connected, as C8 is. Remove land components under 2 u² that hold no
   protected pixel. Turn water components that touch neither the ocean nor the Basin into land.
   Re-apply `P_land` and `P_water`.

**Gate S2a (before the noise).** C8b on the base mask: after the mouth cut, no water joined to the
Basin lies outside the Basin polygon. The one-sided noise keeps a clean base clean; it cannot mend
a leak the base already has.

**Gate S2.** Run the validator on a flat bundle of the final mask (`relief: false`) with
`--checks C1,C3,C8`. Everything passes except the two shoals and the caldera, which need relief.
Also: exactly 9 island components (the eight drawn plus Kelata-Tamu), and one Basin component.

### S3. Provinces and the macro field (`provinces.py`)

A **province** is a physical unit, not a polity. This module is the only code allowed to read the
civ polygons, and it reads them once, to seed province shapes. Nothing downstream sees a polygon.

1. **Shapes.** Each province starts from its schematic shape and is redrawn:
   - Where its edge is a hard line (the wall, the east margin, the Ngaru-Bon west escarpment, the
     rim crest) or a coast, the edge is that line, exactly.
   - Every other edge is displaced by noise, wavelength 60 to 200 u, so no straight political edge
     survives. The displacement is at most `min(12, erode_u - 3)` units for that province's C9 core
     (so 5 u for the southern rim and 7 u for the north arm). This keeps the core inside its
     province. It does not by itself keep C9's percentiles; Gates S3 and S7 check those.
2. **Weights.** Each province has a weight `w_p` in [0, 1] that falls across its edge over a
   transition width set per boundary type, and the weights are normalised to sum to 1:

   | Boundary | Width |
   |---|---|
   | Hard line (scarp) | set by the scarp profile below, not by weights |
   | Lowland to upland with no hard line (Qollari to floodplain, rim landward face) | 25 to 40 u |
   | Upland to upland (Kheshkai to Ngaru-Bon, lip to interior) | 40 to 80 u |
   | Desert lobe to its neighbours | 20 to 30 u |

3. **Profiles.** Each province has a designed elevation function of physical coordinates only:
   distance to a hard line, distance to the coast, latitude, distance to an anchor. The prototype's
   `build()` has a first version of each, and its coarse relief already passes all of C9. Keep its
   shapes; replace label tests with weights. The macro field is `sum(w_p * h_p)`.

   | Province | Profile | Grain |
   |---|---|---|
   | Kheshkai lip and interior | 2,200 m at the lip, rising with distance north of the wall to 3,500 to 4,500 m; 35% lower east of the floodplain's east end | parallel to the wall |
   | Ngaru-Bon | shelf 1,300 to 1,900 m on the south face, crown 3,500 to 4,800 m; not stretched across the top of the map | east to west arcs |
   | Qollari | massif 2,500 to 4,500 m, foothills running north-east to the neck | north-west to south-east |
   | Ndjadi trough | replaced wholesale by S5 | none |
   | Southern rim | crest on the crest line, 300 to 900 m, to 1,500 m in the east; short seaward face, long landward face | parallel to the crest |
   | Irrah north | gravel plateau 300 to 800 m, stepping up toward the escarpment | weak |
   | Irrah south-east | thorn-steppe 300 m rising to escarpments near the coast | parallel to the coast |
   | North arm | limestone hills 250 to 750 m | along the arm |
   | Oravan | one cone per island, peak scaled by island radius, to 3,000 m | radial |
   | Free zone and frame edges | continue the neighbouring province's profile | inherit |

4. **Scarps.** A hard line gets a cross-profile in the signed offset `o` from the line (positive on
   the high side). Within 12 u of the line the profile **replaces** the weighted field, blending back
   to it between 12 and 20 u:
   - **Kheshkai wall:** foot (trough level) at `o <= -2 u`, lip (at least 1,950 m) at `o >= +5 u`,
     smooth between. The lip stays under 2,900 m out to `o = +10 u`. The scarp wraps the wall's west
     end as a quarter-round, holding lip height to the end vertex, then falls to the neck.
   - **Ngaru-Bon west escarpment:** a step, not a ramp. Under 900 m at `o <= -4 u`, at least 1,300 m
     by `o = +4 u`.
   - **East margin:** the same form at half height (C6 bands).
   - **Rim crest:** the crest line carries the ridge maximum; water lies within 60 u to the south.
5. **Relief noise.** Ridged anisotropic noise, amplitude by province weight (prototype amplitudes),
   aligned to the grain column. Amplitude is zero inside the hydro lock (S5) and tapers to zero
   within 3 u of every anchor disk.
6. **Caps and floors.** C6 and C9 have upper bounds, and noise, erosion and upsampling overshoot.
   Two soft caps apply to the **final** field of S3, S7 and S8, by a smooth clip that leaves values
   under 95% of the cap unchanged:
   - 2,850 m inside the wall's north strip (offsets 0 to 12 u north of the wall line; C6 allows 3,000);
   - 4,700 m everywhere (C6 and C9 allow 4,800).

   Lower bounds are held the same way: the lip's 1,950 m at offsets 5 to 8 u, and the Ngaru-Bon
   step's 1,300 m at offsets 4 to 8 u.
7. **Anchors.** For each point with an `elevation_m` band, test C2's rule on the macro field. Where
   it fails, add one smooth stamp of radius `2 * radius_u` that moves the disk to the band's nearer
   third. A stamp is a fix for a profile that almost fits. More than 8 stamps means a profile is
   wrong: fix the profile.

**Gate S3.** C9 passes on the macro field. C6 passes. C2 passes for every inland point.

### S4. Hydro skeleton (`hydro.py`)

The skeleton is a directed tree of coarse cells with a fixed elevation for each cell.

1. **Canon chains.** Rasterise each convergent river's polyline to an 8-connected chain of coarse
   cells, source first. The first cell of a chain is exactly the cell the validator snaps the entry
   to: call `_nearest_land_cell` on the S2 mask.
2. **Merge rule.** Two chains never run side by side. From the first point where two chains come
   within 4 u of each other, both are replaced downstream by one shared chain on their midline.
   The northern tributary and the wall-east tributary run 3 to 5 u apart for 60 u along the wall's
   foot; they merge there. A shared chain must stay within 4 u of every polyline it replaces, which
   leaves 2 u of C4's 6 u tolerance.
3. **Trunk** (amended in M2, section 14: the eastern chains join at the confluence).
   All chains join inside the neck disk. The trunk runs from the join through the coarse
   cell holding `the_neck` to the delta apex, then down distributary 3 to the shore. Distributary 3
   is the single coarse outlet, because a lowest-neighbour rule cannot split (C5c).
4. **Outlet.** The trunk's last land cell is 8-adjacent to a coarse cell that is water by the
   validator's rule, whose centre is inside the Basin polygon and within 85 u of Ki-Mbuhari. That
   water cell is the tree's root.
5. **Long profiles.** Elevations fall strictly downstream, cell by cell, and are set from the ends,
   not from a fixed slope:
   - the trunk's last land cell is 0.9 m, the apex `apex_m` (9 m), the neck `neck_m` (11 m). Between
     the apex and the last land cell the trunk is linear in the row: `T(row)` (amended in M2,
     section 14: `T(y)` at the polyline's own `y` inside the cell), about 0.19 m per
     row. The skeleton's heights are the one profile; S5 derives everything else from them;
   - each chain rises upstream from its join at
     `min(0.2 m/u, (skeleton_top_m - join height) / chain length)`, with `skeleton_top_m = 36`.
     The spine's 0.05 m/km (0.2 m/u) holds on the short chains. The eastern trunk (308 u) and the
     wall-east tributary (278 u) come out near 0.08 m/u. Assert every skeleton cell on the plain is
     at most 36 m.
6. **Headwater catchments.** A river with `entry_min_area_km2` must bring an upland catchment
   through its entry cell: 125 coarse cells for the northern tributary, 63 for wall-east. Reserve
   for each a **catchment bowl** on the plateau behind the entry: a fan-shaped set of at least four
   times the required cells (500 and 250), reached by extending the chain upstream across the scarp
   as a notch (`headwater_notch_m` deep, `headwater_len_u` long). Inside the bowl the starting
   surface is a distance field to the extension, as in S5, so it has no pits and one way out.
   Erodibility in the bowl is one quarter of normal. This guarantee is **gated, not proven**: Gate
   S7 reads the validator's own accumulated area at the entry cell.
7. **Internal sinks.** Three closed basins are declared as sinks: Ngon-Tso, Xal-Tzintla and the
   Iferis sabkha. Each is a disk of floor cells at a fixed elevation (S9 sets shape and height).
   Erosion treats a sink as base level and never fills it. No sink lies in a catchment bowl.

**Gate S4.** The skeleton is a tree rooted at the outlet water cell. Elevations fall strictly
downstream. No skeleton cell is water. Every canon polyline sample beyond `river_head_skip_u` has a
skeleton cell within 4 u.

### S5. Floodplain surface and the hydro lock (`hydro.py`)

1. **The lock set `Lk`** (coarse land cells) is the union of:
   - the macro field's trough lowland (below 80 m, connected to the neck);
   - the Ndjadi polygon eroded by 3 u. This is the one place a polygon enters physics, and only as
     a floor: C5a traces every cell of the polygon's core (eroded by 6 u), so the divide must lie
     outside it;
   - every skeleton cell on the plain, plus a 2-cell halo;
   - the **delta fan**: the land between distributaries 1 and 5, widened by 3 u.
2. **Shore rule.** `Lk` touches water only on the delta front, where the water is Basin water
   within 85 u of Ki-Mbuhari. Everywhere else, the land cells within 2 cells of a water cell are a
   **shore rim** outside `Lk`, at least `wedge_rim_m` (3 m) above the `Lk` cells behind them: beach
   ridges, and along the ocean wedge the south levee of distributary 1. Session reading. Without
   the rim the delta drains into the wedge, which is the prototype's main failure. Gate S5 reports
   any rim cell that falls inside C5a's core; none is expected along the wedge.
3. **Delta fan surface.** The fan is derived from the trunk profile `T(row)` of S4.5, extended by
   the same line to every row of the fan. A fan cell that is not on the trunk takes
   `T(row) + 0.6 m`. That is 0.6 m above the trunk cell in its own row and 0.4 m above the trunk
   cell one row south, so it satisfies the levee rule below, and it is lower than every fan cell
   one row south, so every fan cell has a lower neighbour to the north, down to the Basin.
4. **Levee ring.** Every non-skeleton cell 8-adjacent to a skeleton cell is at least 0.3 m above the
   highest skeleton cell it touches. So from a skeleton cell the lowest neighbour is always another
   skeleton cell, and by the merge rule that cell is downstream on the same chain.
5. **The surface.** The **sources** are fixed, in this precedence: skeleton cells, then fan cells,
   then levee-ring cells, at the heights above. Sources are frozen: the shortest-path pass never
   lowers or raises one. Run Dijkstra over the rest of `Lk` on the 8-connected grid with step cost
   `s_plain * step_length`, starting each source at its own height. A non-source cell's elevation
   is its Dijkstra value.
   - Every non-source cell has a neighbour that is strictly lower: its Dijkstra parent. Every levee
     and fan cell has a lower neighbour by 3 and 4. So the surface has **no pits**, and every
     descent ends on the skeleton or the fan and then in the Basin.
   - `s_plain` is not a free number (amended in M2, section 14: the highest source on `Lk`
     replaces 36.3). It is `min(0.35, (48 - 36.3) / D)` m/u, where `D` is the
     largest Dijkstra distance in `Lk`. Assert `max(h on Lk) <= 48`.
   - Fans where canon rivers enter the plain (a cone of up to 4 m over 15 u at each entry) are
     added to the source heights before Dijkstra runs, never after.
   - **Assert before routing:** every non-source cell of `Lk` was reached; every skeleton cell's
     lowest neighbour is the next skeleton cell downstream (or, inside the neck disk, any skeleton
     cell downstream of it); every levee cell clears its skeleton neighbours by 0.3 m.
6. **Boundary.** Every land cell outside `Lk` that touches `Lk` is higher than every `Lk` cell it
   touches. Raise the outside cell where the macro field is lower. This is the "low divide" that
   closes the plain's east end against Irrah's south-east lobe, and the rim's landward face in the
   south. Water cells at the delta front are exempt: they are the outlet.
7. **The lock.** From here on, the validator's pooling of the raster must return these elevations
   and these land classes on `Lk`, and must return water on the delta-front water cells that touch
   `Lk`. Later stages keep that true (S8 to S10), and Gate S10 re-checks it last.

**Gate S5.** Build a bundle from the coarse field as it stands. Using the validator's flood and
receivers: fill depth is zero on `Lk`; from each chain's first cell the trace stays on skeleton
cells to the root; C4, C5a and C5c pass (C5b waits for S9).

### S6. Rain, first pass (`climate.py`)

Erodibility must not be keyed to polygons (prototype failure 3). It comes from rain and rock.

- **Rain model.** Two seasons, each a moisture stream advected along a fixed wind field and rained
  out on rising ground:
  - **Summer:** onshore from the south and south-east. It crosses the low rim, hits the wall, turns
    west along the wall's foot, runs north in a corridor along Kheshkai's west flank and rises onto
    the Ngaru-Bon shelf, weakening. South-west monsoon over Oravan. The frankincense coast gets fog,
    not rain: cap rain there (a coast-parallel jet over cold water).
  - **Winter:** westerlies enter through the Basin mouth and rain on the north arm and the uplands.
  - Rain at a cell is the upslope gain along the wind, times remaining moisture, plus a small
    base. Moisture falls as it rains. Kheshkai's interior, behind the lip, is in shadow.
- **Erodibility.** `K = K0 * rock * (0.3 + rain_norm)`. `rock` is low-frequency noise in
  [0.6, 1.4] with one authored exception: limestone (the north arm and the frankincense
  escarpments) is 1.3. `K` is zero on `Lk`, on sinks and on water.

**Gate S6.** Annual rain ranks: wall face > Qollari east slope > rim seaward face > Ngaru-Bon
shelf > floodplain > Kheshkai interior > Irrah north. A ranking test, not a number test.

### S7. Coarse erosion (`lem.py`)

The prototype's landscape-evolution core, with three changes.

1. **Base level** is water, `Lk`, sinks and the frame edge. The priority flood seeds from all of
   them. Base cells are never raised or incised.
2. **Area on the plain.** Erosion needs drainage area to carry through `Lk`. Compute receivers on
   `Lk` with the validator's rule (lowest neighbour), so the generator and the validator agree by
   definition.
3. **Catchment bowls** (S4.6) erode at one quarter rate from a pit-free start, so the area they
   collect keeps leaving through the entry cell.

Start from the prototype's numbers (60 steps, dt 500, m 0.5, K0 4e-5, diffusion 0.1, no uplift).
After erosion, re-apply the anchor stamps (S3.7) and the caps and floors (S3.6), then one more flood without incision.

**Gate S7.** On the coarse field: `--checks C2,C4,C5,C6,C9` pass, C5b excepted. The validator's
accumulated area at each entry cell is at least twice `entry_min_area_km2`. If it is not, set the
bowl's erodibility to zero and rebuild; if it still is not, the bowl is too small.

### S8. Fine grid: upsample, detail, fine erosion (`detail.py`, `lem.py`)

1. Upsample the coarse field 4x. **Outside `Lk`** the upsample is cubic. **Inside `Lk`** each
   coarse value is copied to its 16 pixels, so every block mean is exact from the start (cubic
   interpolation does not keep block means). The steps between neighbouring blocks are under
   0.4 m. A blend band two cells wide outside `Lk` joins the two.
2. Clamp every pixel to its S2 class: land at least 0.5 m, water at most -0.2 m. The S2 mask is
   fine-resolution and is the only source of class.
3. Add band-limited detail, wavelength 2 to 12 px, amplitude `15 + 250 * local_relief` metres
   (prototype), anisotropic along the province grain. Detail is zero inside `Lk`.
4. Eight fine erosion steps (prototype numbers), with `Lk` pixels and sinks as base level.
5. Apply the caps and floors (S3.6).
6. **Lock restore.** The lock is about the validator's pooled grid, which has two parts.
   - **Class.** An `Lk` block must be land: fewer than half its pixels negative. A delta-front
     water block that touches `Lk` must be water: at least half negative. Along the delta front the
     fine shoreline is drawn so that this holds: a block whose centre is outside the Basin polygon
     is given at least 9 of 16 land pixels. The land advances, which the one-sided shore allows.
     (Amended in M2, section 14: S5 already does this; S8 keeps it true.)
   - **Elevation.** For every `Lk` block, add one constant to its **land pixels that are not bed
     pixels** (S9) so the block mean equals the coarse value. Beds are never moved by the restore.
     The constant is never negative enough to bring a ground pixel within 0.6 m of a bed in the
     same or a neighbouring block; assert it.

**Gate S8.** `Context.coarse` on the fine raster equals the locked coarse field on `Lk` to 0.01 m,
with the same classes. Outside blocks that hold a bed or a shore, the largest constant applied
was under 0.05 m; a larger one means a stage wrote inside the lock.

### S9. Features (`features.py`)

Fine-scale stamps and carves. Inside `Lk` each is block-mean-zero: what a channel removes, its
levees add back in the same coarse block.

| Feature | What is built | Where it is checked |
|---|---|---|
| **Five distributaries** | See "The fan" below | C5b, K7 |
| **Canon river thalwegs** | A 2 px channel inside each coarse belt, 1 to 2 m deep, with levees | look only |
| **Delta front** | Basin water within 1 u of the delta-front shore is -0.2 to -0.5 m (mudflat); delta-front land is at least 1.5 m. Block classes follow S8.6 | C5a |
| **Qhabal-Ur** | A stepped platform: top at +2 m inside 1 u, a step at -3 m to 2 u, open Basin water around it | C1 shoal |
| **Tavakh-Rubat** | A sandbar 4 u by 1 u across the inner mouth, crest at -1 m, with a crest pixel at +1 m | C1 shoal |
| **First Caldera** | A pool of radius 1.2 u at -30 m at the pin, inside the protected land ring (1.7 to 3 u), with one breach 0.5 u wide toward the nearest coast, cut through the ring. The pool and the breach are `P_water` and outrank the ring | C1 caldera |
| **Kelata-Tamu** | An islet of radius 2 u at the pin, peak 300 m, and a tidal channel at least 1.5 u wide between it and Kelata, in `P_water` | C1 island |
| **Ngon-Tso** | A sink (S4). Lake surface flat at the floor elevation, radius 5 u, on the crown at 3,900 to 4,600 m, rimmed by higher ground on every side | K1 |
| **Lha-Drak** | A south-facing cliff at the crown's south lip: at least 600 m of fall inside 2 u | K2 |
| **Xal-Tzintla** | A sink. A closed depression of radius 7 u, floor at least 150 m under its lowest rim saddle, floor at 2,400 to 3,200 m | K3 |
| **Iferis sabkha** | A sink. A flat pan of radius `extent_u`, at 10 to 25 m, flat to 3 m, the lowest ground of the northern lobe, wadis ending on it. Zin-Iferis stands on its north-east rim | K4 |
| **Central erg** | Linear dune ridges (draa) over a disk of radius `extent_u`: wavelength 3 to 5 px, amplitude 40 to 120 m, aligned to the winter north-easterly. Neither oasis lies inside | K5 |
| **Apu-Yana and the Oravan peaks** | A cone on each: summit crater 1 px deep, flanks 15 to 25% | C2, look |
| **Lam-Chen Pass** | A notch through the crown rim at the pin, floor inside the pass's band | C2 |

`extent_u` is read as a radius. Sizes with no canon number are session readings and live in the
params file.

**The fan.** The five distributaries leave one apex and run under 2 u apart at first, and C5b takes
each channel's banks 2 u to either side. A bank sample that lands in a neighbour's bed cannot be
0.5 m above it for both channels at once. So some samples must fail, and the job is to keep that
under budget (C5b allows 20%).

- **Bed pixels** are exactly the native pixels that hold a C5b sample, found with the validator's
  own `_polyline_samples` at `1/ppu`. Nothing wider. A 3 px channel puts 12 to 22% of a channel's
  samples' banks in a neighbouring bed (22% for distributary 2). A one-sample-wide bed should cut
  that by about two thirds; the gate below measures it.
- **Bed elevation** is one function of the row for all five: `T(y) - 0.6 m` (S5.3), which is 8.4 m
  at the apex and 0.3 m at the shore. Every manifest channel runs strictly north, so every bed
  falls strictly, shared pixels near the apex have one value, and total uphill is zero. Past the
  shore the bed is water.
- **Ground** between and beside the beds is fan surface, `T + 0.6 m` or more, raised a little in
  blocks that hold a bed so the block keeps its mean (S8.6). So a bank sample on ground is at
  least 1.2 m above the bed.
- **Gate K7, run before any other S9 work:** using the validator's bank sampling, at most 10% of
  each channel's samples have a bank in another bed. Measured on the manifest at 4 px/unit with
  one-sample beds (Sol, round 2): 3.2%, 4.9%, 5.8%, 4.6% and 5.1% for distributaries 1 to 5. There
  is no fallback; if a manifest edit pushes a channel over 10%, stop and report.

**Gate S9.** `--checks C1,C5` pass in full. The S8 gate still holds.

### S10. Sea floor (`bathy.py`)

- **Basin:** shallow. -0.3 m at the shore to -150 m at the centre, by distance to land.
- **Ocean:** -2 m at the shore to -3,000 m at 120 u out, with a shelf 10 u wide above -150 m.
- Shoals and the delta front override both.
- No land pixel is under 0 m, and no water pixel is at or over 0 m.

**Gate S10 (the last lock check).** S10 writes water depths, which move block means. Re-run Gate S8,
then the full validator. Nothing after S10 changes `elevation.npy`.

### S11. Rain, final pass, and the biome raster (`climate.py`)

Re-run S6's rain on the final coarse field. Then classify each fine pixel from **latitude,
elevation, annual rain, rain season and slope**, never from a province or a polygon. Latitude is
linear in `y` from the geometry file's `latitude` pairs (34 N at y 80 to 10 N at y 721).

`biome.npy` is uint8. `biomes.json` maps each value to a name and to the hex-fill colour, so the
hex grid and the tiles agree (Invariant 1).

| Value | Biome | Rule of thumb |
|---|---|---|
| 1 | Ocean | water outside the Basin polygon |
| 2 | Basin sea | water inside it |
| 3 | Tropical floodplain and delta | under 80 m, wet summer, in the trough |
| 4 | Mangrove and salt-marsh | Basin shore under 3 m; mangrove on the south shore, marsh on the north |
| 5 | Monsoon forest | wet summer, 100 to 1,500 m, south of 24 N |
| 6 | Cloud forest | wall face and Qollari slopes, 1,200 to 2,600 m, very wet |
| 7 | Thorn savanna | sub-humid lee of the rim; Irrah south-east |
| 8 | Fog escarpment | frankincense coast seaward faces |
| 9 | Gravel desert | Irrah north, rain under the desert threshold |
| 10 | Erg | the central erg disk |
| 11 | Salt pan | sinks flagged sabkha; Basin south and south-east margins under 2 m |
| 12 | Winter-rain scrub and woodland | north arm, winter rain |
| 13 | Midhill forest | Ngaru-Bon shelf, 1,200 to 2,000 m |
| 14 | Montane steppe | Kheshkai lip and Qollari puna, 2,000 to 3,500 m, semi-arid |
| 15 | Cold steppe and alpine desert | Kheshkai interior above 3,500 m, dry |
| 16 | Rock and scree | slope over the rock threshold above 1,000 m |
| 17 | Snow and ice | above a snowline that falls with latitude and rises with dryness |
| 18 | Frozen lake | sinks flagged lake |
| 19 | Volcanic island forest | Oravan under 1,500 m |

Class edges get 1 to 3 px of noise so no biome line is ruler-straight. Rain thresholds live in the
params file.

### S12. Flow raster and vectors (`vectors.py`)

- **Flow.** Fill a copy of the fine surface (sinks excepted), route D8, accumulate. `flow.npy` is
  float32 `log10(area in km²)`. Elevation is not changed by this step.
- **Rivers.** Trace every channel over `river_min_area_km2` (2,000) from head to mouth or sink.
  Canon rivers carry their manifest ID; the rest are unnamed. `rivers.geojson` holds one LineString
  per reach, with `id`, `name`, `strahler` and `area_km2` at the downstream end.
- **Coast.** Marching squares on the mask at the 0 m level, simplified at 0.1 u: `coastline.geojson`
  (polygons for the mainland and each island, plus the Basin as its own polygon).
- **Lakes and pans.** `lakes.geojson`: Ngon-Tso, the sabkha outline, the caldera pool.
- All vector coordinates are schematic units, the manifest's frame.

### S13. Bundle and self-check (`build.py`)

The bundle is PHASE2-SPEC section B, extended. The validator ignores the new keys.

```json
{ "px_per_unit": 4, "width_u": 1200, "height_u": 800, "sea_level_m": 0,
  "elevation": "elevation.npy", "seed": 1, "generator": "generator.terrain.build <git sha>",
  "constraints_sha256": "...", "params_sha256": "...", "content_sha256": "...", "relief": true,
  "biome": "biome.npy", "biomes": "biomes.json", "flow": "flow.npy", "rain": "rain.npy",
  "rivers": "rivers.geojson", "coastline": "coastline.geojson", "lakes": "lakes.geojson",
  "sinks": [ { "id": "ngon_tso", "kind": "lake" } ] }
```

With `--check`, the build then runs the validator and K1 to K12 and writes `REPORT.md` beside the
bundle. The 16-bit PNG and the engine export are Phase 4 and derive from this bundle.

## 6. Parameters (starting values, all in `data/terrain-params.yaml`)

| Name | Value | Name | Value |
|---|---|---|---|
| `seed` | 1 | `a_max_u` (coast noise) | 4 |
| `strait_throat_u` | 5 | `province_warp_u` | 12 |
| `apex_m` | 9 | `neck_m` | 11 |
| `s_plain_m_per_u` | at most 0.35, derived | `river_slope_m_per_u` | at most 0.2, derived |
| `skeleton_top_m` | 36 | `fan_ground_m` (over the trunk line) | 0.6 |
| `lock_lowland_m` | 80 | `wedge_rim_m` | 3 |
| `headwater_len_u` | 40 | `headwater_notch_m` | 150 |
| `lem_coarse` | 60 steps, dt 500, K0 4e-5 | `lem_fine` | 8 steps, dt 400, K0 2e-5 |
| `river_min_area_km2` | 2000 | `cap_wall_m`, `cap_all_m` | 2850, 4700 |

Tuning a number here is expected. Changing a mechanism in section 5 is a spec change.

## 7. Known tight spots

Found while reading the contract against the geometry. Each has a named answer.

| Spot | Why it is tight | Answer |
|---|---|---|
| A-Tzalan Ford sits on the wall line and needs ground under 300 m within 3 u | The scarp foot must be within 2 u south of the line | S3.4 foot at `o <= -2` |
| Breath-of-Cloud is 5 u north of the line, 8 u from the wall's west end, and needs 1,800 m within 3 u | The lip must be up by `o = +5` and must not taper before the end vertex | S3.4 lip and quarter-round |
| The five distributaries are under 2 u apart for the first 8 u below the apex | A bank sample can land in the next channel. At 3 px wide, 12 to 22% of samples do (distributary 2 worst), against a 20% allowance. With one-sample beds it is 3 to 6% | S9 "The fan": one-sample-wide beds, one bed function, a 10% gate |
| The distributary mouths lie 1 u inside the Basin polygon's south edge (0.3 to 1.5 u; channels 4 and 5 were redrawn to reach it, section 14) | The validator calls a block water when half its pixels are negative, whatever its mean. A shore block centred outside the polygon would count as ocean | S8.6 class rule |
| C8b allows no Basin water outside the Basin polygon | Two-sided coast noise breaks it, and so does a sea-route buffer that spills past the polygon (one does, near Tavakh-Qarat) | S1 clipped buffers, Gate S2a, S2.4 one-sided shore |
| The eastern trunk is 308 u long | At the spine's 0.2 m/u it would stand 62 m above its join, over the 50 m plain | S4.5 profiles set from the ends |
| The northern and wall-east tributaries run 3 to 5 u apart for 60 u | A lowest-neighbour trace can hop between two close channels | S4.2 merge rule |
| Halani-Tamu and Dzong-Tamu have a sea route passing about 1 u from their landward side | Half-disk protection collides with the route's water | S1 coast witnesses |
| The ocean wedge reaches the neck | The delta drains into it | S2.1 closes the tip; S5.1 wedge rim |
| Dzong-Tamu's pin is 8 u offshore, Halani-Tamu and Tin-Aghiz 3 to 4 u | The coast must come to them or the wide radius must reach the coast | Radii are already widened in the constraints; S1 protects the landward half-disk so the coast cannot retreat |
| Tepet-Apu needs 200 m within 5 u and stands 11 u from the neck, whose 3 u disk needs a median under 50 m | Qollari's foothill must rise fast on the neck's west side | An anchor stamp, expected; the neck's protected disk bounds it |
| The sabkha, the lake and Xal-Tzintla are closed basins | Any depression fill erases them | S4.4 sinks |

## 8. Check to mechanism

"Proven" means it follows from the construction. "Gated" means designed with margin and then
checked by the validator's own code at the named gate.

| Check | Met by | Kind |
|---|---|---|
| C1 inland, land, island, strait | S1 protection; S2 `a = 0` on protected pixels | proven |
| C1 coast | S1 witnesses; bearing and 80% body share | gated (S2) |
| C1 shoal, caldera | S9 | gated (S9) |
| C2 | S3 profiles and scarps; S3.7 stamps; S3.6 floors | gated (S3, S7, S10) |
| C3 | S1 kept-sample pixels | proven |
| C4 line and terminus | S4 chains and merge rule; S5 levee ring and pit-free surface | pit-freeness proven; the rest gated (S5) |
| C4 entry area | S4.6 catchment bowls | gated (S7) |
| C5a, C5c | S5 lock, shore rule and fan plane; S8.6 block classes | gated (S5, S10) |
| C5b | S9 "The fan" | uphill proven; banks gated (K7) |
| C6 | S3.4 scarp profiles; S3.6 caps and floors | gated (S3, S7, S10) |
| C8a, C8c | S2 `a_max` under the 6 u band; small throat area | gated (S2) |
| C8b | S1 clipped buffers; Gate S2a; S2 one-sided Basin shore | gated (S2a, S2) |
| C9 | S3 profiles (the prototype already passes); bounded warp; caps | gated (S3, S7, S10) |

## 9. Feature checks (`feature_checks.py`)

| # | Passes when |
|---|---|
| K1 | Ngon-Tso: a flat patch of at least 40 u² within 1 m, in its band, lower than every cell on a ring 2 u outside it |
| K2 | Lha-Drak: within 3 u, a fall of at least 600 m over at most 2 u, downhill bearing within 60 degrees of south |
| K3 | Xal-Tzintla: floor in band and at least 150 m under the lowest point of its rim; no D8 path leaves the depression |
| K4 | Sabkha: median of the disk in [2, 60] m; 90% of the inner 80% within 3 m of the median; Zin-Iferis is outside the pan and within 4 u of its edge |
| K5 | Erg: high-pass relief (under 2 u) has a standard deviation of at least 15 m inside the disk; both oases are outside it |
| K6 | No land pixel under 0 m. No water component is cut off from the ocean and the Basin, except the caldera pool |
| K7 | For each distributary: at most 10% of samples have a bank in another channel's bed, and the C5b fraction is at least 0.88 (the contract asks 0.8) |
| K8 | Lock: Gate S8, re-run after S10 |
| K9 | Pits: under 0.1% of land pixels outside sinks have a fill depth over 5 m (the sponge detector) |
| K10 | Determinism: two builds, same hash |
| K11 | Every canon river appears in `rivers.geojson` under its ID and stays within `river_tol_u` of its manifest line |
| K12 | Biome sanity: the ndjadi core is at least 90% class 3 or 4; the Kheshkai interior core holds no forest class; the erg disk is class 10 |

Each K check gets a passing and a failing fixture in `generator/terrain/tests/`, as Phase 2 did.

## 10. How it is looked at

- `build --check` also writes `preview.jpg`: the prototype's `render_v3.py` palette B over the new
  bundle, whole map at 2400 px, plus six crops: the neck and delta, the wall at A-Tzalan, the Halkar
  throat, the Ngaru-Bon crown, the sabkha and erg, the frankincense coast.
- A second image, `edges.jpg`, overlays the civ polygons on the relief. It is how a reviewer sees
  that no terrain or biome line follows a political edge (prototype failure 3).
- These are review aids. The real renderer and tiles are Phase 4.

## 11. Build order

Each milestone is one PR with its gate green. The scoreboard is the validator's count.

| # | Stages | Gate | Lane |
|---|---|---|---|
| M1 | S1, S2, noise, params, build runner | Gate S2 | `/orchestrate` |
| M2 | S4, S5 on a flat upland | Gate S5 | Opus |
| M3 | S3, S6, S7 | Gate S7 | Opus |
| M4 | S8, S9, S10 | Gates S8, S9; validator all green | Opus, then `/orchestrate` for the stamps |
| M5 | S11, S12, S13, K checks, preview | Section 1 | `/orchestrate` |

M2 comes before M3 on purpose. The floodplain and delta are where the prototype failed, and they
can be proven on a flat upland before any mountain exists.

## 12. Out of scope

Tiles, the renderer proper, the Leaflet swap, the poster, the engine export and the 16-bit PNG
(Phase 4). Rias and drowned valleys, extra islets, seasonal flood extent and a tilted 3D view
(`ai/IDEAS.md`). Any edit to the contract.

## 13. Session readings Perry may move

None blocks the build. Each is one number or one sentence in the params file.

- The Halkar throat is 5 u (20 km) at its narrowest, inside a funnel as wide as the schematic's mouth.
- A low beach-ridge rim (3 m) keeps the delta from draining into the ocean wedge.
- The First Caldera's pool is breached to the sea by one channel 2 km wide.
- Xal-Tzintla is 28 km across (radius 7 u) and Ngon-Tso 40 km (radius 5 u).
- `extent_u` on the sabkha and the erg is read as a radius.

## 14. Review

**Round 1: Sol (Codex, pmartin1913), 2026-11-12,** read-only, against `validate.py` and the manifest.
Five high and three medium findings. All were checked against the code, accepted and folded in:

1. The validator pools water by majority, not by mean, so a mean-only lock kept the wrong
   quantity. Now section 2, S5.7, S8.6 and Gate S10.
2. S1's sets collided by construction: the caldera pool sat inside its island's land disk, and
   coast half-disks hit the Coastal Monsoon corridor at Halani-Tamu and Dzong-Tamu. Now witnesses,
   a ring for the caldera and a fixed precedence.
3. A sea-route buffer near Tavakh-Qarat forced Basin-joined water outside the Basin polygon, which
   one-sided noise cannot mend. Now clipped buffers and Gate S2a.
4. A fixed 0.2 m/u put the eastern trunk at 62 m, over the plain's 50 m. Now profiles set from the
   ends.
5. The validator rebuilds receivers from the raster by lowest neighbour and never reads the
   generator's. Now the merge rule, the levee ring, the exact entry cell, the outlet cell, catchment
   bowls with cell counts, and gates that run the validator's own routing.
6. Channel overlap in the fan is 12 to 22% at 3 px wide. Now one-sample beds, one bed function and
   a 10% gate.
7. The 12 u warp exceeded the erosion of two C9 cores (8 and 10 u). Now bounded per province, and
   the "cannot break C9" claim is withdrawn.
8. C6 and C9 upper bounds were unprotected after noise and erosion. Now caps and floors on the
   final field, and scarps replace the macro field instead of adding to it.

**Round 2: Sol, same day.** Six of the eight closed. Two stayed open and four new problems came
from the revision; all are folded in:

- Finding 3: the 0.5 u dilation of sea-route samples was not clipped. Now every optional buffer is
  clipped, and a kept sample outside the polygon is a stop.
- Finding 5 and new 1: the apex was 9 m in S4 and 9.9 m in S5, and fan ground broke the levee
  rule. Now one trunk profile `T(row)`, with fan ground and beds derived from it.
- New 2: an ordinary multi-source Dijkstra could lower a levee through its skeleton neighbour.
  Now sources are frozen, with asserts before routing.
- New 3: cubic upsampling does not keep block means. Now `Lk` blocks are copied, not interpolated.
- New 4: the restore moved bed pixels, and the thinning fallback would have broken C5b's uphill
  limit. Now the restore skips beds and the fallback is gone; measured overlap is 3 to 6%.

**Round 3: Sol, same day.** All six round 2 items closed, no new high finding, verdict "ready to
freeze for implementation". Milestone M2's Gate S5 is the first machine check of the routing.

**M2 amendments, 2026-11-12** (Fable built M2; Sol, Codex pmartin1913, reviewed the diff: no high
finding, two medium findings on the gates, both fixed). Gate S5 passes on the real mask.

1. **S4.3, the join.** The three eastern rivers end 12 to 16 u east-north-east of the neck pin; the
   two Qollari rivers pass through the neck cell on their way to their ends at about (557, 388).
   Taking the eastern bundle back to the neck cell would make a hairpin of about 125 degrees. So the
   chain that passes the neck is bent through the neck cell's centre, its downstream end is the
   **confluence**, the other chains link to the confluence, and the trunk runs confluence, apex,
   distributary 3. Every river still passes within 10 u of the neck (C5a asks 12).
2. **S4.5, the trunk profile.** Distributary 3 crosses 70 columns in 42 rows, so trunk cells share
   rows and `T(row)` would not fall strictly. A trunk cell takes `T(y)` at the mean `y` of the
   polyline inside the cell. Fan ground still uses `T` at the row centre. S9 must take its bed
   heights from the same line.
3. **S4.5, chains.** Above the neck, heights are set chain by chain: the longest path from a join is
   one chain at `min(0.2, (36 - join height) / length)`, and each side branch starts its own.
4. **S4.6, bowls.** A bowl is a fan of half-angle 25 degrees and radius `headwater_len_u` behind the
   entry, plus the cells beside the extension. Its cross slope is 1.5 times the extension's slope;
   at a lower cross slope the notch is a ridge and the bowl drains past the entry. The extension
   leaves from the entry cell's centre and its foot may touch no chain cell but the entry.
5. **S5.5, `s_plain`.** Entry cones lift sources to about 40 m, so the bound uses the highest source
   on `Lk` in place of 36.3.
6. **S8.6, the class rule, pulled forward to S5.** S4 needs the coarse classes, so delta-front blocks
   that pool to water with their centre outside the Basin polygon are given land pixels in S5, and
   the validator's Gate S2 pass is run again on the amended mask. A sea route's corridor buffer is
   optional water and may be released by this rule; kept samples, mouth reservations and witnesses
   may not. A block those keep wet is left and counted (one, at mouth 1, at 2 px/unit).
7. **S1, mouth reservations.** M1 did not clip them to the Basin polygon. M2 does, as the table says.
8. **Gate S5, tightened after review.** A skeleton cell must drain to its own next cell; only inside
   the neck disk may it take a cell further down its path. A lock cell that no source reaches, or
   a land cell of C5a's core outside the lock, stops the build.

**Found in M2, fixed 2026-11-12.** The schematic ended distributary 4 at (525, 338) and
distributary 5 at (556, 338), both on land: 1.2 u and 4.5 u south of the Basin polygon. C5b asks for
Basin water within 1 u of the mouth, and no terrain can supply it there. Perry chose to draw both
through to the shore (worldbuilder #427). They now end at (522.5, 335.5) and (551, 333), 1.5 u and
1.2 u inside the polygon, and all five mouths carry a reservation.

**Measured in M2 (4 px/unit, seed 1).** C5a's neck share is 97.3% against a 95% limit: a strip of
plain under the wall, north of the merged northern chain, drains along the wall's foot to the fan
and passes more than 12 u from the neck. `s_plain` comes out at 0.062 m/u over `D` = 123 u.
