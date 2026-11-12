# Phase 2 prototype baseline (2026-11-11)

The validator was run with all checks against the 2026-11-10 prototype terrain
(`prototype/terrain_v3.py`, 2 px/unit, rebuilt from the README steps). The result was
**74 PASS, 52 FAIL, 0 SKIP**. This is the bar Phase 3 has to clear. The prototype was built to
prove the look and was never given the constraints, so most of these failures are expected. They
also show that the validator tells good terrain from bad.

The validator takes about 2 minutes on this bundle, mostly in the pure-Python priority flood and
the per-cell C5(a) traces.

## What failed, and what Phase 3 must do about it

1. **The Ndjadi drains to the open ocean.** This is the main finding.
   - All 76,911 floodplain core cells trace to ocean water; none reaches the Basin (C5a, C5c).
   - C8(b) finds the Basin joined to the ocean outside the straits.
   - The cause is the schematic's ocean wedge, which reaches the neck (see the canon report), and
     the prototype's domain warp, which breaches the thin delta strip.
   - **Phase 3 has to close the wedge's tip and the strip, as protected land, before erosion
     runs.** Otherwise "nothing south" and "one mouth" cannot hold.
2. **Points are not protected.**
   - The warp moves the coasts up to about 9 units, so ports land in water or inland (C1 and C2
     for Ki-Mbuhari, Tavakh-Qarat, Halani-Tamu, Dzong-Tamu, Veyd-Kirrha and Tin-Aghiz).
   - Sea routes cross the northern arm, and land routes cross the Basin's east shore (C3).
   - The named points and the route corridors have to be protected masks in the macro field
     (PHASE2-SPEC review note), not just checked afterwards.
3. **Canon rivers were never seeded.** All five convergent rivers miss their lines by 15 to 42
   units (C4). All five distributaries run uphill and sit above their banks (C5b), because nothing
   carves them.
4. **The wall and the scarp are too soft.**
   - The Kheshkai wall has the lip and the trough together at only 6 of 34 stations (C6 joint).
   - Breath-of-Cloud never reaches 1,800 m within 3 units, and A-Tzalan Ford never drops to
     300 m (C2).
   - Ngaru-Bon's western scarp stays under 1,200 m within 12 units, at 0 of 10 stations, because
     the shelf ramps up instead of stepping.
5. **What already passes.** All C9 region cores pass: the Kheshkai interior, the Ngaru-Bon crown
   and shelf, the low floodplain, the Qollari highland, both Irrah lobes, the rim and the north
   arm. Also passing:
   - the rim's crest band and its seaward water (C6);
   - the Kheshkai east margin;
   - coast agreement (C8c);
   - the inland upland points.

   The prototype's coarse relief is about right. Phase 3's work is in the constraints.

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
| C1:ki_mbuhari | FAIL | disk must hold land and water (112/112 water) |
| C1:tavakh_qarat | FAIL | disk must hold land and water (0/112 water) |
| C1:halani_tamu | FAIL | disk must hold land and water (316/316 water) |
| C1:dzong_tamu | FAIL | disk must hold land and water (1020/1020 water) |
| C1:veyd_kirrha | FAIL | disk must hold land and water (112/112 water) |
| C1:tin_aghiz | FAIL | disk must hold land and water (316/316 water) |
| C1:qhabal_ur | FAIL | no disk pixel with elevation in [-12.0, 8.0] m |
| C1:tavakh_rubat | FAIL | no disk pixel with elevation in [-12.0, 8.0] m |
| C1:qarat_al_fidda | PASS | 0/112 water pixels in disk |
| C1:ghadam_thalla | PASS | 0/112 water pixels in disk |
| C1:tin_mashraq | PASS | 0/112 water pixels in disk |
| C1:khulut | FAIL | 21/112 water pixels in disk |
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
| C1:tepet_apu | FAIL | 26/314 water pixels in disk |
| C1:ki_jenga | PASS | 1.00 of disk is land (>0.5 required) |
| C1:hassag_nganin | FAIL | 0.29 of disk is land (>0.5 required) |
| C1:the_neck | PASS | 1.00 of disk is land (>0.5 required) |
| C1:halkar_port | PASS | component 3 is not mainland and within area limit |
| C1:kelata | PASS | component 4 is not mainland and within area limit |
| C1:kelata_tamu | FAIL | no land pixel in disk |
| C1:first_caldera | FAIL | no enclosed/near-enclosed water (caldera) in the island |
| C1:morina | PASS | component 2 is not mainland and within area limit |
| C1:arokar | PASS | component 9 is not mainland and within area limit |

## C2 — Point elevation bands (spec C2) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C2:lam_chen_pass | PASS | 112/112 disk pixels in [1200.0, 3500.0] m |
| C2:a_tzalan_ford | FAIL | 0/112 disk pixels in [0.0, 300.0] m |
| C2:smith_spring | PASS | 35/112 disk pixels in [200.0, 1200.0] m |
| C2:breath_of_cloud | FAIL | 0/112 disk pixels in [1800.0, 2600.0] m |
| C2:qollari_cliff_roads | PASS | 112/112 disk pixels in [1000.0, 4000.0] m |
| C2:ki_mbuhari | FAIL | 0/112 disk pixels in [0.0, 30.0] m |
| C2:tavakh_qarat | PASS | 1/112 disk pixels in [0.0, 300.0] m |
| C2:halani_tamu | FAIL | 0/316 disk pixels in [0.0, 150.0] m |
| C2:dzong_tamu | FAIL | 0/1020 disk pixels in [0.0, 150.0] m |
| C2:veyd_kirrha | FAIL | 0/112 disk pixels in [0.0, 400.0] m |
| C2:tin_aghiz | FAIL | 0/316 disk pixels in [0.0, 300.0] m |
| C2:qarat_al_fidda | PASS | 112/112 disk pixels in [100.0, 1000.0] m |
| C2:ghadam_thalla | PASS | 112/112 disk pixels in [150.0, 1000.0] m |
| C2:tin_mashraq | PASS | 112/112 disk pixels in [200.0, 1300.0] m |
| C2:khulut | PASS | 91/112 disk pixels in [0.0, 400.0] m |
| C2:zin_iferis | FAIL | 0/112 disk pixels in [0.0, 600.0] m |
| C2:rubat_al_darb | PASS | 113/113 disk pixels in [100.0, 1100.0] m |
| C2:zang_ri | PASS | 112/112 disk pixels in [1200.0, 3500.0] m |
| C2:dzong_kha | PASS | 116/116 disk pixels in [1500.0, 4500.0] m |
| C2:zang_kalli | PASS | 112/112 disk pixels in [1800.0, 4500.0] m |
| C2:kalli_xal | PASS | 90/111 disk pixels in [1500.0, 2800.0] m |
| C2:kha_tepet | PASS | 316/316 disk pixels in [2500.0, 4800.0] m |
| C2:apu_yana | FAIL | 0/812 disk pixels in [1500.0, 4500.0] m |
| C2:wasi_puma | PASS | 31/112 disk pixels in [1500.0, 4000.0] m |
| C2:wasi_pukya | PASS | 112/112 disk pixels in [1000.0, 4000.0] m |
| C2:tepet_apu | FAIL | 0/314 disk pixels in [200.0, 2500.0] m |
| C2:ki_jenga | PASS | 112/112 disk pixels in [0.0, 50.0] m |
| C2:hassag_nganin | PASS | 32/112 disk pixels in [0.0, 30.0] m |
| C2:the_neck | PASS | disk median 16.6 m in [0.0, 50.0]: True |

## C3 — Routes (spec C3) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C3:copper_for_steel_road[0](land) | PASS | 1060 samples, all on land |
| C3:highland_steppe_corridor[0](land) | FAIL | 1 violating run(s) over 1151 samples: run 1: (540.7,401.6)->(539.1,402.8) len 2.5 u |
| C3:coastal_monsoon[0](sea) | FAIL | 1 violating run(s) over 1046 samples: run 1: (387.6,211.9)->(453.7,203.7) len 63.5 u |
| C3:scribal_ladder[0](sea) | PASS | 421 samples, all on water |
| C3:scribal_ladder[1](land) | FAIL | 1 violating run(s) over 119 samples: run 1: (602.5,262.7)->(614.3,264.4) len 12.5 u |
| C3:western_route[0](sea) | FAIL | 2 violating run(s) over 714 samples: run 1: (378.9,212.5)->(380.2,211.7) len 2.0 u; run 2: (381.1,211.2)->(396.6,202.0) len 18.5 u |
| C3:aethelian_basin_hub[0](sea) | FAIL | 2 violating run(s) over 974 samples: run 1: (404.3,201.3)->(427.2,208.5) len 24.5 u; run 2: (408.3,210.8)->(402.5,203.3) len 10.0 u |
| C3:aethelian_basin_hub[1](river) | FAIL | 1 violating run(s) over 163 samples: run 1: (483.0,340.6)->(500.0,352.9) len 21.5 u |
| C3:highland_relay[0](land) | FAIL | 2 violating run(s) over 755 samples: run 1: (509.5,406.3)->(524.0,395.7) len 18.5 u; run 2: (496.1,352.9)->(483.2,342.6) len 17.0 u |
| C3:highland_relay[1](land) | FAIL | 1 violating run(s) over 167 samples: run 1: (481.0,344.4)->(399.1,336.4) len 83.5 u |
| C3:caravan_thread[0](land) | PASS | 217 samples, all on land |
| C3:caravan_thread[1](land) | PASS | 99 samples, all on land |
| C3:caravan_thread[2](land) | PASS | 124 samples, all on land |
| C3:caravan_thread[3](land) | FAIL | 1 violating run(s) over 120 samples: run 1: (613.5,264.9)->(602.2,262.8) len 12.0 u |
| C3:caravan_thread[4](land) | PASS | 105 samples, all on land |
| C3:caravan_thread[5](land) | FAIL | 1 violating run(s) over 1126 samples: run 1: (1048.5,545.9)->(1055.9,547.3) len 8.0 u |

## C4 — Convergent rivers (spec C4) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C4:ndjadi_tributary_north | FAIL | 135/142 samples beyond 8.0 u have no trace cell within 6.0 u (worst 24.7 u); entry area 48 km2 < entry_min_area_km2 2000 |
| C4:ndjadi_tributary_wall_east | FAIL | 230/269 samples beyond 8.0 u have no trace cell within 6.0 u (worst 23.6 u); entry area 32 km2 < entry_min_area_km2 1000 |
| C4:ndjadi_trunk_east | FAIL | 238/300 samples beyond 8.0 u have no trace cell within 6.0 u (worst 42.5 u) |
| C4:ndjadi_tributary_west | FAIL | 83/151 samples beyond 8.0 u have no trace cell within 6.0 u (worst 15.2 u) |
| C4:ndjadi_tributary_qollari_south | FAIL | 147/199 samples beyond 8.0 u have no trace cell within 6.0 u (worst 17.4 u) |

## C5 — Ndjadi outlet and distributaries (spec C5) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C5a:ocean | FAIL | 76911/76911 core traces end in ocean water ('nothing south') |
| C5a:basin | FAIL | 0/76911 core traces end in Basin water within outlet_r_u 90 of 'ki_mbuhari' (>=99%) |
| C5a:neck | PASS | 71790/71957 southern core traces pass within neck_r_u 12 of 'the_neck' (>=95%) |
| C5c | FAIL | trace ends in water, but not Basin water |
| C5b:ndjadi_dist_1 | FAIL | total uphill 1104.49 m > max_uphill_m 3.0; 0.03 of samples >=0.5 m below both banks (>=0.80 required) |
| C5b:ndjadi_dist_2 | FAIL | total uphill 651.84 m > max_uphill_m 3.0; 0.02 of samples >=0.5 m below both banks (>=0.80 required) |
| C5b:ndjadi_dist_3 | FAIL | total uphill 357.65 m > max_uphill_m 3.0; 0.10 of samples >=0.5 m below both banks (>=0.80 required) |
| C5b:ndjadi_dist_4 | FAIL | total uphill 199.80 m > max_uphill_m 3.0; 0.17 of samples >=0.5 m below both banks (>=0.80 required); mouth sample (or one within 1 u of it) is not Basin water |
| C5b:ndjadi_dist_5 | FAIL | total uphill 56.33 m > max_uphill_m 3.0; 0.02 of samples >=0.5 m below both banks (>=0.80 required); mouth sample (or one within 1 u of it) is not Basin water |

## C6 — Hard-line profiles (spec C6) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C6:kheshkai_wall:side-S | FAIL | 12/34 stations (0.35 >= 0.8) with median over offset [4.0,12.0] toward S in [0,400] m |
| C6:kheshkai_wall:side-N | FAIL | 21/34 stations (0.62 >= 0.8) with max over offset [3.0,10.0] toward N in [1800,3000] m |
| C6:kheshkai_wall:joint | FAIL | 6/34 stations pass all 2 tests together (0.18 >= 0.8) |
| C6:kheshkai_east_margin:side-N | PASS | 21/24 stations (0.88 >= 0.8) with max over offset [3.0,12.0] toward N in [800,2600] m |
| C6:kheshkai_east_margin:side-S | PASS | 24/24 stations (1.00 >= 0.8) with median over offset [3.0,12.0] toward S in [0,1200] m |
| C6:kheshkai_east_margin:joint | PASS | 21/24 stations pass all 2 tests together (0.88 >= 0.8) |
| C6:ngaru_bon_west_escarpment:side-E | FAIL | 0/10 stations (0.00 >= 0.8) with max over offset [4.0,12.0] toward E in [1200,4800] m |
| C6:ngaru_bon_west_escarpment:side-W | PASS | 9/10 stations (0.90 >= 0.8) with median over offset [4.0,12.0] toward W in [0,1000] m |
| C6:ngaru_bon_west_escarpment:joint | FAIL | 0/10 stations pass all 2 tests together (0.00 >= 0.8) |
| C6:southern_rim_west:on_line | PASS | 42/44 stations (0.95 >= 0.8) with max of 1-u disk in [250,1000] m |
| C6:southern_rim_west:water_within | PASS | 44/44 stations (1.00 >= 0.8) with water toward S within 60 u |
| C6:southern_rim_west:joint | PASS | 42/44 stations pass all 2 tests together (0.95 >= 0.8) |
| C6:southern_rim_east:on_line | PASS | 9/11 stations (0.82 >= 0.8) with max of 1-u disk in [250,1600] m |
| C6:southern_rim_east:water_within | PASS | 11/11 stations (1.00 >= 0.8) with water toward S within 60 u |
| C6:southern_rim_east:joint | PASS | 9/11 stations pass all 2 tests together (0.82 >= 0.8) |

## C8 — Water topology and coast (spec C8) **[FAIL]**

| item | result | detail |
|------|--------|--------|
| C8a:connectivity | PASS | 1.000 of Basin-polygon water in one component (>=0.95) |
| C8a:area | PASS | Basin component area 35897 u^2 vs polygon 37728 u^2 (rel diff 0.05 <= 0.15) |
| C8b:mouth | FAIL | after mouth cut r=23.0 u at 'halkar_straits': 20468 Basin-component water pixels outside the Basin polygon |
| C8c:land | PASS | 0.9791 of canon-land pixels agree (>= 0.97) over 1908527 pixels |
| C8c:water | PASS | 0.9969 of canon-water pixels agree (>= 0.97) over 1705680 pixels |

## C9 — Region cores (spec C9) **[PASS]**

| item | result | detail |
|------|--------|--------|
| C9:kheshkai_interior | PASS | 70673 land cells in core; all percentile bands hold |
| C9:ngaru_bon | PASS | 30078 land cells in core; all percentile bands hold |
| C9:ndjadi | PASS | 57741 land cells in core; all percentile bands hold |
| C9:qollari | PASS | 37960 land cells in core; all percentile bands hold |
| C9:irrah_north | PASS | 8719 land cells in core; all percentile bands hold |
| C9:irrah_se | PASS | 19884 land cells in core; all percentile bands hold |
| C9:southern_rim | PASS | 27020 land cells in core; all percentile bands hold |
| C9:north_arm | PASS | 26967 land cells in core; all percentile bands hold |
