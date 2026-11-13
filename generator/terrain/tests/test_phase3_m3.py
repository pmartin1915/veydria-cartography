"""Phase 3 milestone M3: S3 provinces, S6 rain, S7 coarse erosion, Gate S7.

The real-data tests build S2 once (seed 1, 2 px/unit), then S3, S4/S5
(without Gate S5, which the M2 module covers), S6 and S7, and run Gate S7
once. Gate S7 is the validator's own flood on the coarse field, so the
module costs about four minutes.
"""

from __future__ import annotations

import copy

import numpy as np
import pytest

from generator.terrain import climate as C
from generator.terrain import hydro as H
from generator.terrain import lem as L
from generator.terrain import mask as M
from generator.terrain import provinces as PV
from generator.terrain import validate as V
from generator.terrain.protect import GateError

PPU = 2


# --- small pieces ----------------------------------------------------------------

def test_soft_cap_leaves_low_values_and_never_passes_the_cap():
    h = np.array([0.0, 2000.0, 2700.0, 2850.0, 4000.0, 9000.0])
    out = PV.soft_cap(h, 2850.0)
    assert np.array_equal(out[:3], h[:3])  # under 95% of the cap: unchanged
    assert (out <= 2850.0).all() and out[3] < 2850.0
    assert (np.diff(out) >= 0).all()  # still ordered


def test_signed_distance_is_positive_inside():
    inside = np.zeros(PV.SHAPE, dtype=bool)
    inside[100:200, 300:500] = True
    sd = PV.signed_distance(inside)
    assert sd[150, 400] > 40 and sd[150, 600] < -90
    assert abs(sd[150, 300]) < 1 and abs(sd[150, 299]) < 1


def test_line_offset_is_positive_north_of_a_west_to_east_line():
    offset, frac = PV.line_offset([(100.0, 400.0), (900.0, 400.0)])
    assert offset[380, 500] == pytest.approx(19.5)
    assert offset[420, 500] == pytest.approx(-20.5)
    assert frac[400, 100] < 0.01 and frac[400, 899] > 0.99


def _toy_weights(params):
    sd = {name: np.full(PV.SHAPE, -500.0) for name in params["s3"]["provinces"]}
    cols = np.arange(PV.COLS)[None, :] + np.zeros(PV.SHAPE)
    sd["kheshkai"] = 600.0 - cols  # west of x = 600
    sd["irrah_north"] = cols - 600.0  # east of it
    sd["ndjadi"] = 100.0 - np.abs(np.arange(PV.ROWS)[:, None] - 400.0) + np.zeros(PV.SHAPE)
    return PV.province_weights(sd, params)


def test_weights_sum_to_one_and_a_lowland_keeps_its_level_to_its_edge(canon):
    w = _toy_weights(canon["params"])
    total = np.sum(np.stack(list(w.values())), axis=0)
    assert np.allclose(total, 1.0)
    # far from the trough: the desert lobe has bias 40 and the upland soft 40,
    # so the upland is gone at the shared edge and the ramp lies inside it
    assert w["kheshkai"][100, 601] < 0.01 and w["irrah_north"][100, 601] > 0.99
    assert 0.3 < w["kheshkai"][100, 580] < 0.7
    assert w["kheshkai"][100, 550] > 0.99


def test_the_trough_is_an_overlay(canon):
    w = _toy_weights(canon["params"])
    reach = canon["params"]["s3"]["provinces"]["ndjadi"]["reach_u"]
    assert w["ndjadi"][400, 300] == pytest.approx(1.0)  # inside: all of it
    assert w["ndjadi"][300, 300] == pytest.approx(1.0)  # on its edge
    assert w["ndjadi"][300 - reach - 2, 300] == 0.0  # gone reach_u outside
    assert 0.2 < w["ndjadi"][300 - reach // 2, 300] < 0.8


def test_anchor_stamp_moves_a_failing_disk_and_respects_frozen(canon):
    manifest, constraints, params = canon["manifest"], canon["constraints"], canon["params"]
    lo, hi = constraints["points"]["kalli_xal"]["elevation_m"]
    x, y = (int(v) for v in manifest_point(manifest, "kalli_xal"))
    field = np.full(PV.SHAPE, 1e5)  # every band fails high ...
    for pid, entry in constraints["points"].items():  # ... except where the bands already hold
        band = entry.get("elevation_m")
        if band and pid != "kalli_xal":
            px, py = manifest_point(manifest, pid)
            yy, xx = np.ogrid[:PV.ROWS, :PV.COLS]
            field[np.hypot(xx + 0.5 - px, yy + 0.5 - py) <= 10] = (band[0] + band[1]) / 2
    out, stamps = PV.apply_anchors(field, manifest, constraints, params)
    assert [s["id"] for s in stamps] == ["kalli_xal"]
    assert lo <= out[y, x] <= hi
    frozen = np.zeros(PV.SHAPE, dtype=bool)
    frozen[y - 8:y + 9, x - 8:x + 9] = True
    held, _ = PV.apply_anchors(field, manifest, constraints, params, frozen=frozen)
    assert np.array_equal(held[frozen], field[frozen])


def manifest_point(manifest, pid):
    from generator.terrain.canon import resolve_point
    return resolve_point(manifest, pid)


def test_too_many_stamps_is_a_gate_failure(canon):
    with pytest.raises(GateError, match="anchor stamps"):
        PV.apply_anchors(np.full(PV.SHAPE, 1e5), canon["manifest"], canon["constraints"],
                         canon["params"])


# --- erosion core ------------------------------------------------------------------

def _tilted(rows=40, cols=60):
    h = 100.0 + 5.0 * np.arange(cols)[None, :] + np.zeros((rows, cols))
    base = np.zeros((rows, cols), dtype=bool)
    base[:, 0] = True
    return h, base


def test_priority_flood_fills_a_pit_and_leaves_base_cells():
    h, base = _tilted()
    h[20, 30] = 0.0  # a pit
    out = L.priority_flood(h, base, 1e-3)
    assert np.array_equal(out[:, 0], h[:, 0])
    assert out[20, 30] > out[20, 29] - 5.0 and out[20, 30] >= h[20, 29] - 5.0
    lowest = np.minimum.reduce([np.roll(out, s, axis=a) for a in (0, 1) for s in (1, -1)])
    assert (lowest[1:-1, 1:-1] < out[1:-1, 1:-1]).all()  # every inner cell has a lower neighbour


def test_receivers_take_the_lowest_neighbour():
    h, base = _tilted()
    h[10, 20] = 50.0  # lower than everything round it
    rec, _dist = L.receivers(h, np.zeros(h.shape, dtype=bool))
    cols = h.shape[1]
    for r in (9, 10, 11):
        for c in (19, 20, 21):
            if (r, c) != (10, 20):
                assert rec[r * cols + c] == 10 * cols + 20
    assert rec[10 * cols + 20] == 10 * cols + 20  # a pit is its own receiver


def test_area_is_conserved_down_a_slope():
    h, base = _tilted()
    area = L.drainage_area(h, np.zeros(h.shape, dtype=bool), 4000.0)
    assert area[:, 0].sum() == pytest.approx(h.size * 16e6)


def test_evolve_never_moves_base_or_held_cells():
    rng = np.random.default_rng(3)
    h, base = _tilted()
    h = h + rng.uniform(0, 20, h.shape)
    hold = np.zeros(h.shape, dtype=bool)
    hold[15:20, 30:35] = True
    k = np.full(h.shape, 4e-5)
    out, area = L.evolve(h, base, np.zeros(h.shape, dtype=bool), k, 10, 500.0, 4000.0,
                         0.5, 0.1, 1e-3, hold=hold)
    assert np.array_equal(out[base], h[base]) and np.array_equal(out[hold], h[hold])
    assert out[~base & ~hold].mean() < h[~base & ~hold].mean()  # it eroded
    again, _ = L.evolve(h, base, np.zeros(h.shape, dtype=bool), k, 10, 500.0, 4000.0,
                        0.5, 0.1, 1e-3, hold=hold)
    assert out.tobytes() == again.tobytes()


# --- rain --------------------------------------------------------------------------

def test_a_ridge_is_wet_to_windward_and_dry_in_its_lee(canon):
    s6 = canon["params"]["s6"]
    rows, cols = 60, 90
    x = np.arange(cols)[None, :] + np.zeros((rows, cols))
    hs = 2000.0 * np.exp(-((x - 45.0) / 6.0) ** 2)  # a north-south ridge
    water = x < 10
    rain = C._stream(hs, water, np.ones((rows, cols)), 270.0, 4.0, s6)  # wind from the west
    assert rain[30, 36:44].mean() > 5 * rain[30, 47:55].mean()
    assert rain[30, 36:44].mean() > rain[30, 15:25].mean()  # flat ground upwind: travelling rain only


def test_gate_s6_is_a_ranking_test():
    regions = {name: np.zeros((4, 8), dtype=bool) for name in C.GATE_S6_ORDER}
    annual = np.zeros((4, 8))
    for n, name in enumerate(C.GATE_S6_ORDER):
        regions[name][:, n] = True
        annual[:, n] = 10.0 - n
    rain = C.Rain(annual=annual, seasons={}, norm=annual / 10.0)
    assert list(C.gate_s6(rain, regions)) == list(C.GATE_S6_ORDER)
    annual[:, 4], annual[:, 5] = annual[:, 5].copy(), annual[:, 4].copy()
    with pytest.raises(GateError, match="floodplain is not wetter than kheshkai_interior"):
        C.gate_s6(rain, regions)


# --- real data ---------------------------------------------------------------------

@pytest.fixture(scope="module")
def built(canon, prot):
    manifest, geometry = canon["manifest"], canon["geometry"]
    constraints, params = canon["constraints"], canon["params"]
    stages = M.build_mask(prot, manifest, geometry, constraints, params, 1)
    pv = PV.build_provinces(H.coarse_water(stages["final"], PPU), manifest, geometry,
                            constraints, params, 1)
    hydro, _mask = H.construct_hydro(stages["final"], prot, pv.macro, manifest, geometry,
                                     constraints, params, lock_exempt=pv.lock_exempt,
                                     bowl_cost=pv.bowl_cost)
    rain = C.rain_first_pass(hydro.coarse, hydro.water_c, pv, params)
    coarse, area, stamps = L.erode_coarse(hydro, pv, rain, manifest, constraints, params, 1)
    # Gate S7 raises on failure.
    gate = L.gate_s7(coarse, hydro, manifest, geometry, constraints, params)
    return {"pv": pv, "hydro": hydro, "rain": rain, "coarse": coarse, "area": area,
            "stamps": stamps, "gate": gate, "s2": stages["final"]}


def test_gate_s3_passes_on_the_composed_field(built, canon):
    rows = PV.gate_s3(built["hydro"].coarse, canon["manifest"], canon["geometry"],
                      canon["constraints"])
    assert rows and all(result == V.PASS for result, _ in rows.values())
    assert any(item.startswith("C9") for item in rows)
    assert len(built["pv"].stamps) <= canon["params"]["s3"]["max_stamps"]


def test_gate_s3_fails_on_a_flat_upland(built, canon):
    flat = np.where(built["hydro"].water_c, H.WATER_M, 300.0)
    with pytest.raises(GateError, match="GATE S3"):
        PV.gate_s3(flat, canon["manifest"], canon["geometry"], canon["constraints"])


def test_weights_on_real_shapes(built):
    w = built["pv"].weights
    assert np.allclose(np.sum(np.stack(list(w.values())), axis=0), 1.0)
    # no margin runs along the edge two provinces share (Ngaru-Bon and Kheshkai)
    assert w["margin"][20:180, 790:810].max() < 0.01


def test_the_cone_leaves_the_lock_and_holds_its_height(built, canon):
    pv, hydro = built["pv"], built["hydro"]
    assert pv.lock_exempt.any() and not (pv.lock_exempt & hydro.lk).any()
    lo, _hi = canon["constraints"]["points"]["apu_yana"]["elevation_m"]
    assert built["coarse"][pv.lock_exempt].max() >= lo
    assert np.array_equal(built["coarse"][pv.lock_exempt], hydro.coarse[pv.lock_exempt])


def test_bowls_are_cut_into_the_upland(built):
    pv, hydro = built["pv"], built["hydro"]
    source = np.zeros(H.SHAPE, dtype=bool)
    for line in hydro.skeleton.ext.values():
        source.ravel()[line] = True
    from scipy import ndimage
    source = ndimage.binary_dilation(source, structure=np.ones((3, 3), dtype=bool))
    cut = (hydro.bowls > 0) & ~source
    assert cut.sum() > 100
    assert (hydro.coarse[cut] <= pv.macro[cut]).all()
    lowest = ndimage.minimum_filter(hydro.coarse, size=3)
    assert (lowest[hydro.bowls > 0] < hydro.coarse[hydro.bowls > 0]).all()  # no pits


def test_rain_ranks(built, canon):
    regions = C.gate_regions(built["hydro"].coarse, built["hydro"].water_c, built["hydro"].lk,
                             built["pv"], canon["manifest"], canon["geometry"],
                             canon["constraints"], canon["params"])
    means = C.gate_s6(built["rain"], regions)  # raises when the order is wrong
    assert list(means) == list(C.GATE_S6_ORDER)
    assert built["rain"].norm.min() >= 0.0 and built["rain"].norm.max() == 1.0


def test_erodibility_is_zero_on_fixed_ground(built, canon):
    hydro = built["hydro"]
    fixed = hydro.water_c | hydro.lk | (hydro.sinks > 0)
    k = C.erodibility(built["rain"], built["pv"], fixed, hydro.bowls, canon["params"], 1, 4e-5)
    assert (k[fixed] == 0).all() and (k[~fixed] > 0).all()


def test_gate_s7_rows_and_entry_areas(built, canon):
    gate = built["gate"]
    judged = {item: res for item, (res, _) in gate["validator"].items()
              if not item.startswith("C5b")}
    assert judged and all(res == V.PASS for res in judged.values())
    for prefix in ("C2", "C4", "C5a", "C5c", "C6", "C9"):
        assert any(item.startswith(prefix) for item in judged)
    margin = canon["params"]["s4"]["entry_area_margin"]
    for rid, entry in canon["constraints"]["rivers"].items():
        if entry.get("entry_min_area_km2") is not None:
            assert gate["entry_area_km2"][rid] >= margin * entry["entry_min_area_km2"]


def test_erosion_keeps_the_lock_the_sinks_and_the_classes(built):
    hydro, coarse = built["hydro"], built["coarse"]
    still = hydro.lk | hydro.rim | (hydro.sinks > 0) | hydro.water_c | built["pv"].lock_exempt
    assert np.array_equal(coarse[still], hydro.coarse[still])
    assert (coarse[~hydro.water_c] > 0).all() and (coarse[hydro.water_c] < 0).all()
    moved = ~still & ~built["pv"].lock_exempt
    assert np.abs(coarse[moved] - hydro.coarse[moved]).mean() > 10  # it did erode


def test_outside_land_still_stands_above_the_lock(built):
    from scipy import ndimage
    hydro = built["hydro"]
    h = built["coarse"].astype(np.float32).astype(np.float64)
    near = ndimage.maximum_filter(np.where(hydro.built, h, -np.inf), size=3,
                                  mode="constant", cval=-np.inf)
    outside = ~hydro.water_c & ~hydro.built & ~(hydro.sinks > 0) & np.isfinite(near)
    assert (h[outside] > near[outside]).all()


def test_s3_and_s7_are_deterministic(built, canon, prot):
    manifest, geometry = canon["manifest"], canon["geometry"]
    constraints, params = canon["constraints"], canon["params"]
    pv = PV.build_provinces(H.coarse_water(built["s2"], PPU), manifest, geometry,
                            constraints, params, 1)
    assert pv.macro.tobytes() == built["pv"].macro.tobytes()
    coarse, _area, _stamps = L.erode_coarse(built["hydro"], built["pv"], built["rain"],
                                            manifest, constraints, params, 1)
    assert coarse.tobytes() == built["coarse"].tobytes()
    other = PV.build_provinces(H.coarse_water(built["s2"], PPU), manifest, geometry,
                               constraints, params, 2)
    assert other.macro.tobytes() != pv.macro.tobytes()


# --- gates fail when they should -----------------------------------------------------

@pytest.mark.parametrize("what, name", [
    ("lk", "the hydro lock"), ("rim", "the shore rim"), ("sinks", "a sink"),
    ("lock_exempt", "an authored cone"),
])
def test_gate_s7_fails_when_held_ground_moves(built, canon, what, name):
    hydro = built["hydro"]
    broken = built["coarse"].copy()
    cells = np.argwhere(getattr(hydro, what) > 0)
    r, c = cells[len(cells) // 2]
    broken[r, c] += 1.0
    with pytest.raises(GateError, match=f"moved a cell of {name}"):
        L.gate_s7(broken, hydro, canon["manifest"], canon["geometry"],
                  canon["constraints"], canon["params"])


def test_ties_go_to_the_first_neighbour_in_offset_order():
    """The validator breaks an exact tie by flood order; this core takes the
    first neighbour in offset order. Gate S7 therefore reads the validator's
    own area, and this test pins what the core does."""
    h = np.full((5, 5), 10.0)
    h[2, 1] = h[2, 3] = 5.0  # two equally low neighbours of the centre
    rec, _ = L.receivers(h, np.zeros(h.shape, dtype=bool))
    assert rec[2 * 5 + 2] == 2 * 5 + 1


def test_gate_s7_fails_when_an_entry_loses_its_catchment(built, canon):
    params = copy.deepcopy(canon["params"])
    params["s4"]["entry_area_margin"] = 1e6
    with pytest.raises(L.EntryAreaError, match="at the entry"):
        L.gate_s7(built["coarse"], built["hydro"], canon["manifest"], canon["geometry"],
                  canon["constraints"], params)
