"""Phase 3 milestone M2: S4 hydro skeleton, S5 floodplain surface, Gate S5.

The real-data tests build S2 once (seed 1, 2 px/unit) and run S4, S5 and
both gates once. Gate S5 is the validator's own flood and traces on the
coarse field, so the module costs about four minutes.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest
from scipy import ndimage

from generator.terrain import hydro as H
from generator.terrain import mask as M
from generator.terrain import protect as P
from generator.terrain import validate as V
from generator.terrain.canon import rasterize_mask, resolve_point

PPU = 2
BOX3 = np.ones((3, 3), dtype=bool)


# --- polylines and chains ------------------------------------------------------

def test_chain_is_thin_and_8_connected():
    cells, ymean = H.chain_cells([(10.5, 10.5), (40.2, 23.7), (41.0, 60.0)])
    assert cells[0] == H.flat(10, 10) and cells[-1] == H.flat(60, 41)
    assert len(set(cells)) == len(cells) == len(ymean)
    for a, b in zip(cells, cells[1:]):
        assert H._step(a, b) < 1.5
    for a, c in zip(cells, cells[2:]):
        assert H._step(a, c) > 1.5  # no cell touches the cell two steps on


def test_chain_erases_a_loop():
    loop = [(10.5, 10.5), (20.5, 10.5), (20.5, 15.5), (15.5, 15.5), (15.5, 5.5)]
    cells, _ = H.chain_cells(loop)
    assert len(set(cells)) == len(cells)
    assert cells[-1] == H.flat(5, 15)
    assert H.flat(15, 20) not in cells  # the loop's far corner is gone


def test_chain_mean_y_follows_a_northward_line():
    _, ymean = H.chain_cells([(560.0, 380.0), (490.0, 338.0)])
    assert all(a > b for a, b in zip(ymean, ymean[1:]))


def test_close_chains_merge_onto_their_weighted_midline():
    paths = {"a": [(0.0, 100.0), (100.0, 100.0)],
             "b": [(0.0, 130.0), (50.0, 103.0), (100.0, 103.0)]}
    open_, arms = H.merge_rivers(paths, 4.0)
    assert len(open_) == 1 and set(open_[0].rivers) == {"a", "b"}
    assert len(arms) == 2 and all(arm.down is open_[0] for arm in arms)
    assert open_[0].pts[-1] == pytest.approx([100.0, 101.5])
    for arm in arms:  # each arm ends where the shared line starts
        assert arm.pts[-1] == pytest.approx(open_[0].pts[0])


def test_distant_chains_do_not_merge():
    paths = {"a": [(0.0, 100.0), (100.0, 100.0)], "b": [(0.0, 110.0), (100.0, 110.0)]}
    open_, arms = H.merge_rivers(paths, 4.0)
    assert len(open_) == 2 and not arms


def test_three_chains_zip_from_the_upstream_end():
    paths = {"a": [(0.0, 100.0), (200.0, 100.0)],
             "b": [(0.0, 120.0), (60.0, 103.0), (200.0, 103.0)],
             "c": [(0.0, 60.0), (140.0, 98.0), (200.0, 98.0)]}
    open_, arms = H.merge_rivers(paths, 4.0)
    assert len(open_) == 1 and set(open_[0].rivers) == {"a", "b", "c"}
    assert len(arms) == 4
    assert open_[0].pts[-1] == pytest.approx([200.0, (100 + 103 + 98) / 3])


def test_merge_rejects_chains_that_start_together():
    paths = {"a": [(0.0, 100.0), (100.0, 100.0)], "b": [(0.0, 101.0), (100.0, 101.0)]}
    with pytest.raises(P.GateError) as exc:
        H.merge_rivers(paths, 4.0)
    assert exc.value.gate == "S4"


# --- delta-front class rule (synthetic) ----------------------------------------

def _front_case(protect: str = ""):
    # A Basin polygon whose south edge cuts row 150 just under the block
    # centre: at 2 px/unit the block has 2 of 4 pixels in the polygon (it
    # pools to water) while its centre is outside it.
    manifest = {
        "water": {"aethelian_basin": {"polygon": [
            [100, 100], [200, 100], [200, 150.4], [100, 150.4]]}},
        "rivers": {"d": {"path": [[150, 160], [150, 150]]}},
    }
    constraints = {"rivers": {"d": {"kind": "distributary"}}}
    params = {"s2": {"delta_front_zone_u": 20}}
    shape = (H.ROWS * PPU, H.COLS * PPU)
    in_basin = rasterize_mask(H.basin_polygon(manifest), PPU)
    mask = ~in_basin
    p_water = np.zeros(shape, dtype=bool)
    if protect:
        p_water[300:302, 300:302] = ~mask[300:302, 300:302]  # block (150, 150)
    buffer = p_water.copy() if protect == "buffer" else np.zeros(shape, dtype=bool)
    prot = P.Protection(ppu=PPU, p_land=np.zeros(shape, dtype=bool), p_water=p_water,
                        canon_land=mask.copy(), in_basin_poly=in_basin,
                        mouth_cut=np.zeros(shape, dtype=bool), p_water_buffer=buffer)
    return mask, prot, manifest, constraints, params


def test_front_fix_gives_straddling_blocks_to_the_land():
    mask, prot, manifest, constraints, params = _front_case()
    assert H.coarse_water(mask, PPU)[150, 150]  # before: water, centre outside the polygon
    fixed, released, counts = H.front_fix(mask, prot, manifest, constraints, params)
    assert counts["fixed"] > 0 and counts["left_protected"] == 0 and not released.any()
    after = H.coarse_water(fixed, PPU)
    assert not after[150, 131:170].any()  # inside the zone: land now
    assert after[150, 105]  # outside the zone: untouched
    assert after[149, 150]  # the row inside the polygon is still Basin water
    assert not (mask & ~fixed).any()  # land only advances


def test_front_fix_leaves_hard_protected_water_and_counts_it():
    mask, prot, manifest, constraints, params = _front_case("hard")
    fixed, released, counts = H.front_fix(mask, prot, manifest, constraints, params)
    assert counts["left_protected"] == 1 and counts["fixed"] > 0 and not released.any()
    assert not fixed[prot.p_water].any()
    after = H.coarse_water(fixed, PPU)
    assert after[150, 150] and not after[150, 151]  # only the protected block stays wet


def test_front_fix_may_release_a_sea_route_buffer():
    mask, prot, manifest, constraints, params = _front_case("buffer")
    fixed, released, counts = H.front_fix(mask, prot, manifest, constraints, params)
    assert counts["left_protected"] == 0 and counts["buffer_pixels_released"] == 1
    assert released.sum() == 1 and prot.p_water[released].all() and fixed[released].all()
    assert not H.coarse_water(fixed, PPU)[150, 150]


# --- real data -----------------------------------------------------------------

@pytest.fixture(scope="module")
def built(canon, prot):
    stages = M.build_mask(prot, canon["manifest"], canon["geometry"],
                          canon["constraints"], canon["params"], 1)
    macro = np.full(H.SHAPE, float(canon["params"]["m2_flat_upland_m"]))
    # build_hydro runs Gate S4 and Gate S5 and raises on failure.
    hydro, mask = H.build_hydro(stages["final"], prot, macro, canon["manifest"],
                                canon["geometry"], canon["constraints"], canon["params"])
    return {"hydro": hydro, "mask": mask, "s2": stages["final"], "macro": macro}


def _h32(hydro):
    return hydro.coarse.astype(np.float32).astype(np.float64)


def test_gate_s5_validator_rows(built):
    rows = built["hydro"].report["s5"]["validator"]
    judged = {item: res for item, (res, _) in rows.items() if not item.startswith("C5b")}
    assert len([k for k in judged if k.startswith("C4:")]) == 5
    assert {"C5a:ocean", "C5a:basin", "C5a:neck", "C5c"} <= set(judged)
    assert set(judged.values()) == {V.PASS}
    assert any(item.startswith("C5b") for item in rows)  # C5b waits for S9


def test_skeleton_is_a_tree_that_falls_to_the_outlet(built):
    hydro = built["hydro"]
    skel, h = hydro.skeleton, _h32(hydro).ravel()
    assert hydro.water_c.ravel()[skel.root] and hydro.front.ravel()[skel.root]
    for cell, down in skel.parent.items():
        assert not hydro.water_c.ravel()[cell]
        assert H._step(cell, down) < 1.5
        if down != skel.root:
            assert h[cell] > h[down]
    for path in skel.river_paths.values():
        assert skel.parent[path[-1]] == skel.root


def test_neck_and_confluence(built, canon):
    skel = built["hydro"].skeleton
    neck = resolve_point(canon["manifest"], "the_neck")
    assert skel.neck_cell == H.flat(int(neck[1]), int(neck[0]))
    assert skel.neck_cell in skel.parent
    assert skel.height[skel.neck_cell] == pytest.approx(canon["params"]["neck_m"])
    cx, cy = skel.confluence
    assert np.hypot(cx - neck[0], cy - neck[1]) <= 12
    for path in skel.river_paths.values():  # every river passes inside the neck disk
        assert min(np.hypot((c % H.COLS) + 0.5 - neck[0], (c // H.COLS) + 0.5 - neck[1])
                   for c in path) <= 10


def test_canon_lines_and_profile_bounds(built, canon):
    hydro = built["hydro"]
    skel = hydro.skeleton
    worst = hydro.report["s4"]["canon_sample_worst_u"]
    assert len(worst) == 5 and max(worst.values()) <= canon["params"]["s4"]["skeleton_tol_u"]
    top = canon["params"]["skeleton_top_m"] + canon["params"]["s5"]["entry_cone_m"]
    assert max(skel.height[c] for c in skel.plain) <= top + 1e-9
    assert skel.height[skel.trunk[-1]] == pytest.approx(canon["params"]["s4"]["last_land_m"])
    assert skel.height[skel.trunk[0]] == pytest.approx(canon["params"]["apex_m"])


def test_levee_ring_clears_the_skeleton(built, canon):
    hydro = built["hydro"]
    h = _h32(hydro)
    skel_h = np.full(H.SHAPE, -np.inf)
    for cell in hydro.skeleton.parent:
        skel_h.ravel()[cell] = h.ravel()[cell]
    touched = ndimage.maximum_filter(skel_h, size=3, mode="constant", cval=-np.inf)
    ring = hydro.built & ~np.isfinite(skel_h) & np.isfinite(touched)
    assert ring.sum() > 1000
    levee = canon["params"]["s5"]["levee_m"]
    assert (h[ring] - touched[ring]).min() >= levee - 1e-4


def test_lock_has_no_pits_and_stays_in_band(built, canon):
    hydro = built["hydro"]
    h = _h32(hydro)
    lowest = ndimage.minimum_filter(h, size=3, mode="constant", cval=np.inf)
    assert (lowest < h)[hydro.built].all()
    s5 = canon["params"]["s5"]
    assert h[hydro.lk].max() <= s5["plain_max_m"]
    assert h[hydro.built].min() >= s5["min_land_m"] - 1e-6
    assert 0 < hydro.s_plain <= canon["params"]["s_plain_m_per_u_cap"]
    assert hydro.report["s5"]["rim_cells_in_c5a_core"] == 0
    assert hydro.report["s5"]["skeleton_hops"] <= 1  # at most the trunk's last land cell


def test_lock_touches_only_front_water(built):
    hydro = built["hydro"]
    other = hydro.water_c & ~hydro.front
    assert not (hydro.lk & ndimage.binary_dilation(other, structure=BOX3, iterations=2)).any()
    assert (hydro.lk & ndimage.binary_dilation(hydro.front, structure=BOX3)).any()
    assert not (hydro.lk & hydro.rim).any() and not (hydro.lk & hydro.water_c).any()


def test_outside_land_stands_above_the_lock(built, canon):
    hydro = built["hydro"]
    h = _h32(hydro)
    inside = np.where(hydro.built, h, -np.inf)
    near = ndimage.maximum_filter(inside, size=3, mode="constant", cval=-np.inf)
    outside = ~hydro.water_c & ~hydro.built & np.isfinite(near)
    assert outside.any()
    assert (h[outside] - near[outside]).min() >= canon["params"]["s5"]["divide_margin_m"] - 1e-4
    behind = ndimage.maximum_filter(np.where(hydro.lk, h, -np.inf), size=5,
                                    mode="constant", cval=-np.inf)
    rim = hydro.rim & np.isfinite(behind)
    assert (h[rim] - behind[rim]).min() >= canon["params"]["wedge_rim_m"] - 1e-4


def test_catchment_bowls(built, canon):
    hydro = built["hydro"]
    rivers = canon["constraints"]["rivers"]
    assert list(hydro.skeleton.ext) == [
        rid for rid, e in rivers.items() if e.get("entry_min_area_km2") is not None]
    for n, rid in enumerate(hydro.skeleton.ext, start=1):
        need = canon["params"]["s4"]["bowl_factor"] * rivers[rid]["entry_min_area_km2"] / 16
        assert (hydro.bowls == n).sum() >= need
    assert not ((hydro.bowls > 0) & hydro.lk).any()
    assert not ((hydro.sinks > 0) & hydro.built).any()
    assert [s["id"] for s in hydro.sink_list] == ["ngon_tso", "xal_tzintla", "iferis_sabkha"]


def test_amended_mask_keeps_protection_and_pools_to_the_coarse_classes(built, prot):
    hydro, mask = built["hydro"], built["mask"]
    assert mask[prot.p_land].all()
    assert not mask[prot.p_water & ~hydro.released_water].any()
    assert not (hydro.released_water & ~prot.p_water_buffer).any()  # only buffer water is released
    assert not (built["s2"] & ~mask).any()  # the class rule only adds land
    assert np.array_equal(H.coarse_water(mask, PPU), hydro.water_c)


def test_mouths_short_of_the_basin_leave_no_pond(built, canon, prot):
    """Distributaries 4 and 5 end on land south of the Basin polygon. Their
    mouth reservations are clipped to it (spec S1), so no pond is cut off
    inside the delta."""
    hydro = built["hydro"]
    xx, yy = H._cell_centres()
    for rid in ("ndjadi_dist_4", "ndjadi_dist_5"):
        mx, my = canon["manifest"]["rivers"][rid]["path"][-1]
        disk = P._disk_raster(prot.p_water.shape, PPU, mx, my, 1.0)
        assert not prot.in_basin_poly[disk].any()  # the whole disk is outside the Basin
        assert not prot.p_water[disk].any()
        near = (xx - mx) ** 2 + (yy - my) ** 2 <= 9
        assert not (hydro.water_c & ~hydro.front & near).any()


def test_construction_is_deterministic(built, canon, prot):
    again, mask = H.construct_hydro(built["s2"], prot, built["macro"], canon["manifest"],
                                    canon["geometry"], canon["constraints"], canon["params"])
    assert np.array_equal(mask, built["mask"])
    assert again.coarse.tobytes() == built["hydro"].coarse.tobytes()
    assert again.skeleton.parent == built["hydro"].skeleton.parent


# --- gates fail when they should -------------------------------------------------

def test_gate_s4_fails_when_a_profile_rises(built, canon):
    hydro = built["hydro"]
    skel = hydro.skeleton
    cell = skel.river_paths["ndjadi_trunk_east"][40]
    bad = dataclasses.replace(skel, height={**skel.height, cell: skel.height[cell] - 5.0})
    with pytest.raises(P.GateError) as exc:
        H.gate_s4(bad, hydro.water_c, hydro.front, canon["manifest"],
                  canon["constraints"], canon["params"])
    assert exc.value.gate == "S4" and "fall" in str(exc.value)


def test_gate_s4_fails_on_a_drowned_skeleton_cell(built, canon):
    hydro = built["hydro"]
    water = hydro.water_c.copy()
    water.ravel()[hydro.skeleton.river_paths["ndjadi_tributary_west"][20]] = True
    with pytest.raises(P.GateError) as exc:
        H.gate_s4(hydro.skeleton, water, hydro.front, canon["manifest"],
                  canon["constraints"], canon["params"])
    assert exc.value.gate == "S4"


def test_gate_s4_fails_when_a_chain_strays_from_its_line(built, canon):
    hydro = built["hydro"]
    params = {**canon["params"], "s4": {**canon["params"]["s4"], "skeleton_tol_u": 0.5}}
    with pytest.raises(P.GateError) as exc:
        H.gate_s4(hydro.skeleton, hydro.water_c, hydro.front, canon["manifest"],
                  canon["constraints"], params)
    assert "canon sample" in str(exc.value)


def test_gate_s5_fails_on_a_pit_in_the_lock(built, canon):
    hydro = built["hydro"]
    r, c = np.argwhere(ndimage.binary_erosion(hydro.lk, structure=BOX3, iterations=6))[500]
    coarse = hydro.coarse.copy()
    coarse[r, c] = max(coarse[r - 1:r + 2, c - 1:c + 2].min() - 1.0, 0.2)
    with pytest.raises(P.GateError) as exc:
        H.gate_s5(dataclasses.replace(hydro, coarse=coarse), canon["manifest"],
                  canon["geometry"], canon["constraints"], canon["params"])
    assert exc.value.gate == "S5" and "no lower" in str(exc.value)


def test_gate_s5_fails_when_the_core_leaves_the_lock(built, canon):
    hydro = built["hydro"]
    lk = hydro.lk.copy()
    r, c = np.argwhere(ndimage.binary_erosion(lk, structure=BOX3, iterations=12))[900]
    lk[r, c] = False
    with pytest.raises(P.GateError) as exc:
        H.gate_s5(dataclasses.replace(hydro, lk=lk), canon["manifest"],
                  canon["geometry"], canon["constraints"], canon["params"])
    assert exc.value.gate == "S5"


def test_gate_s5_fails_when_the_field_drowns_a_lock_cell(built, canon):
    hydro = built["hydro"]
    coarse = hydro.coarse.copy()
    coarse.ravel()[hydro.skeleton.neck_cell] = -1.0
    with pytest.raises(P.GateError) as exc:
        H.gate_s5(dataclasses.replace(hydro, coarse=coarse), canon["manifest"],
                  canon["geometry"], canon["constraints"], canon["params"])
    assert exc.value.gate == "S5" and "pool" in str(exc.value)
