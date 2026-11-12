# Phase 2 canon self-check (2026-11-11)

The validator (`PHASE2-SPEC.md`) was run against the **canon mask**: the schematic's land and
water with no relief (land +100 m, water -50 m, 2 px/unit). It checks only what the mask can
answer: C1, C3, the C6 water tests and C8. A FAIL here is a canon or schematic fact that the
generated terrain has to resolve. None of these is a validator bug.

Reproduce: `python -m generator.terrain.canon_mask <dir>`, then
`python -m generator.terrain.validate <dir> --checks C1,C3,C6,C8`.

## Reading (6 FAILs)

| Item | What it means | Who resolves it |
|---|---|---|
| C1 `qhabal_ur`, `tavakh_rubat` | A shoal needs an elevation between -12 and +8 m. A flat mask has only +100 and -50 | Phase 3 builds the platform and the sandbar. Expected here |
| C1 `first_caldera` | The schematic draws a solid island. The caldera's seawater pocket is not drawn | Phase 3 cuts the caldera. Expected here |
| C1 `kelata_tamu` | The pin sits 8 units from any land. The schematic draws eight islands, and Kelata-Tamu's outer sister-island is not one of them | Phase 3 adds an islet at the pin, across a tidal channel from Kelata. **Perry: confirm that, or move the pin** |
| C3 `highland_relay[0]`, 4 u wet at (538,386) | The schematic's ocean wedge between the delta's shore strip and Qollari runs its tip to the neck | Phase 3 must close the wedge's tip. See the prototype report: the open wedge sends the whole Ndjadi into the ocean |
| C3 `highland_relay[1]`, 0.5 u wet at (399,336) | Veyd-Kirrha's coastal road clips the Basin polygon's edge | The coast refinement absorbs it |

Tolerances set from this run, each recorded in `data/terrain-constraints.yaml`:
- Coast radius 5 for Halani-Tamu and Tin-Aghiz, which lie 3 to 4 units off the drawn shore.
- Coast radius 9 for Dzong-Tamu, whose pin sits about 8 units offshore.
- The Halkar stop radius is 23, because the port's pin is mid-island.
- The mouth cut is 23, the smallest disk that covers the Basin polygon's reach west of the mouth
  line.
- The island area cap is 5,000 u², against a largest island of about 2,930 u².

---


## C1 — Point class (spec C1) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C1:lam_chen_pass | PASS | 0/112 water pixels in disk |
| C1:a_tzalan_ford | PASS | 0/112 water pixels in disk |
| C1:smith_spring | PASS | 0/112 water pixels in disk |
| C1:breath_of_cloud | PASS | 0/112 water pixels in disk |
| C1:qollari_cliff_roads | PASS | 0/112 water pixels in disk |
| C1:halkar_straits | PASS | run 26.5 u within [2.0, 28.0]; joins basin and ocean through water: True |
| C1:ki_mbuhari | PASS | 1.00 of water is basin; water centroid bearing 0 deg vs faces N (+/-67.5 deg) |
| C1:tavakh_qarat | PASS | 1.00 of water is basin; water centroid bearing 173 deg vs faces S (+/-67.5 deg) |
| C1:halani_tamu | PASS | 1.00 of water is basin; water centroid bearing -90 deg vs faces W (+/-67.5 deg) |
| C1:dzong_tamu | PASS | 1.00 of water is basin; water centroid bearing -14 deg vs faces NW (+/-67.5 deg) |
| C1:veyd_kirrha | PASS | 1.00 of water is basin; water centroid bearing 7 deg vs faces N (+/-67.5 deg) |
| C1:tin_aghiz | PASS | 1.00 of water is ocean; water centroid bearing 131 deg vs faces SE (+/-67.5 deg) |
| C1:qhabal_ur | FAIL | no disk pixel with elevation in [-12.0, 8.0] m |
| C1:tavakh_rubat | FAIL | no disk pixel with elevation in [-12.0, 8.0] m |
| C1:qarat_al_fidda | PASS | 0/112 water pixels in disk |
| C1:ghadam_thalla | PASS | 0/112 water pixels in disk |
| C1:tin_mashraq | PASS | 0/112 water pixels in disk |
| C1:khulut | PASS | 0/112 water pixels in disk |
| C1:zin_iferis | PASS | 0/112 water pixels in disk |
| C1:rubat_al_darb | PASS | 0/113 water pixels in disk |
| C1:zang_ri | PASS | 0/112 water pixels in disk |
| C1:dzong_kha | PASS | 0/116 water pixels in disk |
| C1:zang_kalli | PASS | 0/112 water pixels in disk |
| C1:kalli_xal | PASS | 0/111 water pixels in disk |
| C1:kha_tepet | PASS | 0/316 water pixels in disk |
| C1:volata_xal | PASS | 0/112 water pixels in disk |
| C1:apu_yana | PASS | 0/812 water pixels in disk |
| C1:wasi_puma | PASS | 0/112 water pixels in disk |
| C1:wasi_pukya | PASS | 0/112 water pixels in disk |
| C1:tepet_apu | PASS | 0/314 water pixels in disk |
| C1:ki_jenga | PASS | 1.00 of disk is land (>0.5 required) |
| C1:hassag_nganin | PASS | 1.00 of disk is land (>0.5 required) |
| C1:the_neck | PASS | 1.00 of disk is land (>0.5 required) |
| C1:halkar_port | PASS | component 3 is not mainland and within area limit |
| C1:kelata | PASS | component 4 is not mainland and within area limit |
| C1:kelata_tamu | FAIL | no land pixel in disk |
| C1:first_caldera | FAIL | no enclosed/near-enclosed water (caldera) in the island |
| C1:morina | PASS | component 2 is not mainland and within area limit |
| C1:arokar | PASS | component 9 is not mainland and within area limit |

## C3 — Routes (spec C3) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C3:copper_for_steel_road[0](land) | PASS | 1060 samples, all on land |
| C3:highland_steppe_corridor[0](land) | PASS | 1151 samples, all on land |
| C3:coastal_monsoon[0](sea) | PASS | 1046 samples, all on water |
| C3:scribal_ladder[0](sea) | PASS | 421 samples, all on water |
| C3:scribal_ladder[1](land) | PASS | 119 samples, all on land |
| C3:western_route[0](sea) | PASS | 714 samples, all on water |
| C3:aethelian_basin_hub[0](sea) | PASS | 974 samples, all on water |
| C3:aethelian_basin_hub[1](river) | PASS | 163 samples, all on land |
| C3:highland_relay[0](land) | FAIL | 1 violating run(s) over 755 samples: run 1: (538.7,386.9)->(535.9,384.7) len 4.0 u |
| C3:highland_relay[1](land) | FAIL | 1 violating run(s) over 167 samples: run 1: (399.1,336.4)->(399.1,336.4) len 0.5 u |
| C3:caravan_thread[0](land) | PASS | 217 samples, all on land |
| C3:caravan_thread[1](land) | PASS | 99 samples, all on land |
| C3:caravan_thread[2](land) | PASS | 124 samples, all on land |
| C3:caravan_thread[3](land) | PASS | 120 samples, all on land |
| C3:caravan_thread[4](land) | PASS | 105 samples, all on land |
| C3:caravan_thread[5](land) | PASS | 1126 samples, all on land |

## C6 — Hard-line profiles (spec C6) **[SKIP]**

| item | result | detail |
|------|--------|--------|
| C6:kheshkai_wall:side-S | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:kheshkai_wall:side-N | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:kheshkai_east_margin:side-N | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:kheshkai_east_margin:side-S | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:ngaru_bon_west_escarpment:side-E | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:ngaru_bon_west_escarpment:side-W | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:southern_rim_west:on_line | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:southern_rim_west:water_within | PASS | 44/44 stations (1.00 >= 0.8) with water toward S within 60 u |
| C6:southern_rim_east:on_line | SKIP | SKIP: bundle declares relief: false (spec D) |
| C6:southern_rim_east:water_within | PASS | 11/11 stations (1.00 >= 0.8) with water toward S within 60 u |

## C8 — Water topology and coast (spec C8) **[PASS]**

| item | result | detail |
|------|--------|--------|
| C8a:connectivity | PASS | 1.000 of Basin-polygon water in one component (>=0.95) |
| C8a:area | PASS | Basin component area 37730 u^2 vs polygon 37728 u^2 (rel diff 0.00 <= 0.15) |
| C8b:mouth | PASS | after mouth cut r=23.0 u at 'halkar_straits': 0 Basin-component water pixels outside the Basin polygon |
| C8c:land | PASS | 1.0000 of canon-land pixels agree (>= 0.97) over 1908527 pixels |
| C8c:water | PASS | 1.0000 of canon-water pixels agree (>= 0.97) over 1705680 pixels |
