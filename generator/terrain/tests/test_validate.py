"""Tests for the Phase 2 terrain validator (spec D: fixtures on small synthetic
arrays and dicts, plus preflight rejections and a real-data ID resolution test).

Every check has at least one PASS and one FAIL fixture; every SKIP carries a
reason (spec C, acceptance criteria).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import yaml

from generator.terrain import canon, canon_mask, validate as V

LAND = 10.0
WATER = -10.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_ctx(elev, cons=None, man=None, geo=None, ppu=1, relief=True, sea=0.0):
    elev = np.asarray(elev, dtype=np.float64)
    if ppu > 1:
        # build a fine array from a coarse description is the caller's job;
        # here we just accept the array as-is
        pass
    return V.Context(
        elev=elev, ppu=ppu, relief=relief, sea_level=sea,
        constraints=cons or {}, manifest=man or {}, geometry=geo or {},
    )


def flat(rows, cols, value=LAND):
    return np.full((rows, cols), value, dtype=np.float64)


def result_of(rows, item):
    matches = [r for r in rows if r.item == item]
    assert len(matches) == 1, f"expected one row for {item!r}, got {matches}"
    return matches[0].result


def basin_manifest(x0, y0, x1, y1):
    return {"water": {"aethelian_basin": {
        "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}}}


def points_manifest(**coords):
    return {"chokepoints": {k: {"coords": list(v)} for k, v in coords.items()}}


# ---------------------------------------------------------------------------
# Preflight (spec B)
# ---------------------------------------------------------------------------

def _write_bundle(tmp_path, meta, elev):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "terrain.json").write_text(json.dumps(meta), encoding="utf-8")
    np.save(tmp_path / "elevation.npy", np.asarray(elev, dtype=np.float32))
    return tmp_path


GOOD_META = {"px_per_unit": 1, "width_u": 4, "height_u": 3, "sea_level_m": 0,
             "elevation": "elevation.npy", "seed": 0, "generator": "test",
             "constraints_sha256": "x"}


def test_preflight_ok(tmp_path):
    _write_bundle(tmp_path, GOOD_META, flat(3, 4))
    bundle = V.load_bundle(tmp_path, strict_frame=False)
    assert bundle.ppu == 1 and bundle.relief and bundle.elevation.shape == (3, 4)


@pytest.mark.parametrize("ppu", [0, -1, 1.5, "2", True])
def test_preflight_rejects_bad_ppu(tmp_path, ppu):
    meta = dict(GOOD_META, px_per_unit=ppu)
    _write_bundle(tmp_path, meta, flat(3, 4))
    with pytest.raises(V.PreflightError):
        V.load_bundle(tmp_path, strict_frame=False)


def test_preflight_rejects_wrong_shape(tmp_path):
    _write_bundle(tmp_path, GOOD_META, flat(4, 4))
    with pytest.raises(V.PreflightError, match="shape"):
        V.load_bundle(tmp_path, strict_frame=False)


def test_preflight_rejects_non_finite(tmp_path):
    elev = flat(3, 4)
    elev[1, 1] = np.nan
    _write_bundle(tmp_path, GOOD_META, elev)
    with pytest.raises(V.PreflightError, match="non-finite"):
        V.load_bundle(tmp_path, strict_frame=False)


# ---------------------------------------------------------------------------
# C1: point classes
# ---------------------------------------------------------------------------

def c1_ctx(elev, pid, entry, man_extra=None):
    cons = {"points": {pid: entry}, "defaults": {"point_radius_u": 3}}
    man = points_manifest(**{pid: (20, 15)})
    if man_extra:
        man = _merge(man, man_extra)
    return make_ctx(elev, cons=cons, man=man)


def _merge(a, b):
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def test_c1_inland_pass():
    ctx = c1_ctx(flat(30, 40), "p", {"class": "inland"})
    assert result_of(V.check_c1(ctx), "C1:p") == V.PASS


def test_c1_inland_fail():
    elev = flat(30, 40)
    elev[14:17, 18:22] = WATER
    ctx = c1_ctx(elev, "p", {"class": "inland"})
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def test_c1_land_pass():
    elev = flat(30, 40)
    elev[:, 25:] = WATER
    ctx = c1_ctx(elev, "p", {"class": "land"})
    # move the point near the coast but still mostly land
    ctx.manifest["chokepoints"]["p"]["coords"] = [24, 15]
    assert result_of(V.check_c1(ctx), "C1:p") == V.PASS


def test_c1_land_fail():
    elev = flat(30, 40)
    elev[:, 25:] = WATER
    ctx = c1_ctx(elev, "p", {"class": "land"})
    ctx.manifest["chokepoints"]["p"]["coords"] = [28, 15]
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def _coast_ctx(faces="E", water="basin"):
    elev = flat(30, 40)
    elev[:, 25:] = WATER
    cons = {"points": {"p": {"class": "coast", "water": water, "faces": faces}},
            "defaults": {"point_radius_u": 3}}
    man = _merge(points_manifest(p=(24, 15)),
                 basin_manifest(25, 0, 40, 30))
    return make_ctx(elev, cons=cons, man=man)


def test_c1_coast_pass():
    assert result_of(V.check_c1(_coast_ctx("E")), "C1:p") == V.PASS


def test_c1_coast_fail_bearing():
    assert result_of(V.check_c1(_coast_ctx("W")), "C1:p") == V.FAIL


def test_c1_coast_fail_wrong_body():
    # water is ocean, but the entry says basin
    assert result_of(V.check_c1(_coast_ctx("E", water="ocean")), "C1:p") == V.FAIL


def _island_elev(caldera=False):
    elev = flat(30, 40, WATER)
    elev[20:, :] = LAND                      # mainland
    elev[5:12, 5:12] = LAND                  # island 7x7
    if caldera:
        elev[8, 8] = WATER                   # enclosed lake
    return elev


def test_c1_island_pass():
    cons = {"points": {"p": {"class": "island"}}}
    man = points_manifest(p=(8.5, 8.5))
    ctx = make_ctx(_island_elev(), cons=cons, man=man)
    assert result_of(V.check_c1(ctx), "C1:p") == V.PASS


def test_c1_island_fail_mainland():
    cons = {"points": {"p": {"class": "island"}}}
    man = points_manifest(p=(20, 25))
    ctx = make_ctx(_island_elev(), cons=cons, man=man)
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def test_c1_caldera_pass():
    cons = {"points": {"p": {"class": "island", "caldera": True, "radius_u": 4}}}
    man = points_manifest(p=(8.5, 8.5))
    ctx = make_ctx(_island_elev(caldera=True), cons=cons, man=man)
    assert result_of(V.check_c1(ctx), "C1:p") == V.PASS


def test_c1_caldera_fail_no_enclosed_water():
    cons = {"points": {"p": {"class": "island", "caldera": True, "radius_u": 4}}}
    man = points_manifest(p=(8.5, 8.5))
    ctx = make_ctx(_island_elev(caldera=False), cons=cons, man=man)
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def _strait_ctx(channel_to_edge=False):
    elev = flat(30, 40, LAND)
    elev[:, :10] = WATER                     # basin water (x < 10)
    if channel_to_edge:
        elev[5:30, 10:14] = WATER            # unbounded channel to the frame edge
    else:
        elev[5:16, 10:14] = WATER            # bounded channel
    cons = {"points": {"p": {"class": "strait", "axis": "NS", "min_u": 2, "max_u": 28}}}
    man = _merge(points_manifest(p=(11.5, 10)), basin_manifest(0, 0, 10, 30))
    return make_ctx(elev, cons=cons, man=man)


def test_c1_strait_pass():
    assert result_of(V.check_c1(_strait_ctx()), "C1:p") == V.PASS


def test_c1_strait_fail_unbounded():
    assert result_of(V.check_c1(_strait_ctx(channel_to_edge=True)), "C1:p") == V.FAIL


def test_c1_strait_fail_length():
    ctx = _strait_ctx()
    ctx.constraints["points"]["p"]["min_u"] = 20  # run is ~11 u
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def _shoal_ctx(band_value=0.0, base=WATER):
    elev = flat(30, 40, base)
    elev[15, 15] = band_value                # shoal pixel in the band [-12, 8]
    cons = {"points": {"p": {"class": "shoal", "water": "basin", "radius_u": 3}}}
    man = _merge(points_manifest(p=(15.5, 15.5)), basin_manifest(0, 0, 40, 30))
    return make_ctx(elev, cons=cons, man=man)


def test_c1_shoal_pass():
    assert result_of(V.check_c1(_shoal_ctx()), "C1:p") == V.PASS


def test_c1_shoal_fail_no_band_pixel():
    # deep water everywhere: -20 is outside the default shoal band [-12, 8]
    ctx = _shoal_ctx(band_value=-20.0, base=-20.0)
    assert result_of(V.check_c1(ctx), "C1:p") == V.FAIL


def test_c1_skip_unknown_class_and_empty_input():
    ctx = c1_ctx(flat(30, 40), "p", {"class": "inland"})
    ctx.constraints["points"]["q"] = {"class": "wat"}
    ctx.manifest["chokepoints"]["q"] = {"coords": [5, 5]}
    rows = V.check_c1(ctx)
    assert result_of(rows, "C1:q") == V.SKIP
    assert "unknown" in [r for r in rows if r.item == "C1:q"][0].detail
    ctx2 = make_ctx(flat(30, 40), cons={"points": {}}, man={})
    rows2 = V.check_c1(ctx2)
    assert rows2[0].result == V.SKIP and rows2[0].detail


# ---------------------------------------------------------------------------
# C2: point elevation bands
# ---------------------------------------------------------------------------

def _c2_ctx(vals, sample="any"):
    elev = flat(30, 40)
    rr, cc = np.meshgrid(np.arange(12, 19), np.arange(17, 24), indexing="ij")
    elev[rr, cc] = vals
    cons = {"points": {"p": {"class": "inland", "elevation_m": [5, 15],
                             "sample": sample}},
            "defaults": {"point_radius_u": 3}}
    return make_ctx(elev, cons=cons, man=points_manifest(p=(20, 15)))


def test_c2_any_pass():
    vals = np.full((7, 7), 100.0)
    vals[3, 3] = 10.0
    assert result_of(V.check_c2(_c2_ctx(vals)), "C2:p") == V.PASS


def test_c2_any_fail():
    assert result_of(V.check_c2(_c2_ctx(np.full((7, 7), 100.0))), "C2:p") == V.FAIL


def test_c2_median_pass():
    vals = np.full((7, 7), 100.0)
    vals[:, :4] = 10.0                       # median (25 values) is 10
    assert result_of(V.check_c2(_c2_ctx(vals, "median")), "C2:p") == V.PASS


def test_c2_median_fail():
    vals = np.full((7, 7), 10.0)
    vals[0, 0] = 100.0
    assert result_of(V.check_c2(_c2_ctx(vals, "median")), "C2:p") == V.PASS
    ctx = _c2_ctx(np.full((7, 7), 100.0), "median")
    assert result_of(V.check_c2(ctx), "C2:p") == V.FAIL


def test_c2_skip_when_relief_false():
    ctx = _c2_ctx(np.full((7, 7), 100.0))
    ctx.relief = False
    rows = V.check_c2(ctx)
    assert rows[0].result == V.SKIP and "relief" in rows[0].detail


# ---------------------------------------------------------------------------
# C3: routes
# ---------------------------------------------------------------------------

def _c3_ctx(land_mask_fn=None, mode="land", stops=None):
    rows, cols = 30, 60
    elev = flat(rows, cols)
    if land_mask_fn:
        elev = land_mask_fn(elev)
    cons = {"routes": {"r1": {"mode": mode}}, "defaults": {"route_end_tol_u": 4}}
    if stops:
        cons["routes"]["r1"]["stops"] = stops
    man = {"trade_routes": {"r1": {"path": [[5, 15], [55, 15]]}},
           "chokepoints": {"s1": {"coords": [30, 15]}}}
    return make_ctx(elev, cons=cons, man=man)


def test_c3_land_pass():
    assert result_of(V.check_c3(_c3_ctx()), "C3:r1[0](land)") == V.PASS


def test_c3_land_fail_violating_run():
    def water_strip(elev):
        elev[10:21, 25:35] = WATER
        return elev
    ctx = _c3_ctx(water_strip)
    row = [r for r in V.check_c3(ctx) if r.item.startswith("C3:r1")][0]
    assert row.result == V.FAIL
    assert "run 1" in row.detail and "len" in row.detail


def test_c3_sea_pass_and_stops_dropped():
    elev = flat(30, 60, WATER)
    # a land island around the stop; samples near the stop must be dropped,
    # so the island must fit entirely inside the drop radius
    elev[10:21, 28:34] = LAND
    ctx = _c3_ctx(lambda e: elev, mode="sea", stops=["s1"])
    row = [r for r in V.check_c3(ctx) if r.item.startswith("C3:r1")][0]
    assert row.result == V.PASS


def test_c3_stop_radius_override():
    """A stop given as {id, r_u} widens its drop radius (wide island: fail at r 4, pass at r 12)."""
    elev = flat(30, 60, WATER)
    elev[10:21, 21:40] = LAND
    narrow = _c3_ctx(lambda e: elev.copy(), mode="sea", stops=["s1"])
    wide = _c3_ctx(lambda e: elev.copy(), mode="sea", stops=[{"id": "s1", "r_u": 12}])
    assert [r for r in V.check_c3(narrow) if r.item.startswith("C3:r1")][0].result == V.FAIL
    assert [r for r in V.check_c3(wide) if r.item.startswith("C3:r1")][0].result == V.PASS


def test_c3_modes_ranges():
    # sea part over water, land part over land, meeting at a mode-change vertex
    elev = flat(30, 60, WATER)
    elev[:, 30:] = LAND
    cons = {"routes": {"r1": {"modes": [{"vertices": [0, 1], "mode": "sea"},
                                         {"vertices": [1, 2], "mode": "land"}]}},
            "defaults": {"route_end_tol_u": 4}}
    man = {"trade_routes": {"r1": {"path": [[10, 15], [30, 15], [50, 15]]}}}
    rows = V.check_c3(make_ctx(elev, cons=cons, man=man))
    assert result_of(rows, "C3:r1[0](sea)") == V.PASS
    assert result_of(rows, "C3:r1[1](land)") == V.PASS


def test_c3_parts_count_mismatch_skips():
    cons = {"routes": {"r1": {"parts": [{"mode": "land"}, {"mode": "land"}]}}}
    man = {"trade_routes": {"r1": {"path": [[5, 15], [55, 15]]}}}
    rows = V.check_c3(make_ctx(flat(30, 60), cons=cons, man=man))
    assert rows[0].result == V.SKIP and "parts" in rows[0].detail


# ---------------------------------------------------------------------------
# C4: convergent rivers
# ---------------------------------------------------------------------------

def _c4_elev(floor=95.0):
    """Land slopes down east to water at x>=45; a bowl at (20,15) with a spill
    corridor east (x 26..40 corridor at 100 down to water)."""
    rows, cols = 30, 50
    elev = np.full((rows, cols), 300.0)
    elev[:, 31:45] = np.linspace(100.0, 10.0, 14)  # spill at 100 down to 10
    elev[:, 45:] = WATER
    yy, xx = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    dist = np.hypot(xx - 20, yy - 15)
    bowl = dist < 8
    rim = (dist >= 8) & (dist < 10)
    elev[bowl] = floor
    elev[rim] = 300.0
    gap = (np.abs(yy - 15) <= 1) & (xx > 20) & (xx < 31)
    elev[gap] = 100.0                        # spill corridor
    # tiny cross-slope keeps the D8 trace on the y=15 axis
    elev = elev + np.abs(np.arange(rows)[:, None] - 15) * 0.01
    return elev


def _c4_ctx(floor=95.0):
    cons = {"rivers": {"riv": {"kind": "convergent",
                               "terminus": {"disk": "neck", "r_u": 3}}},
            "defaults": {"river_tol_u": 6, "river_head_skip_u": 8,
                         "max_fill_m": 10, "max_uphill_m": 3, "bank_u": 2}}
    man = {"rivers": {"riv": {"path": [[12, 15], [20, 15], [28, 15], [38, 15]]}},
           "chokepoints": {"neck": {"coords": [38, 15]}}}
    return make_ctx(_c4_elev(floor), cons=cons, man=man)


def test_c4_pass():
    rows = V.check_c4(_c4_ctx(floor=95.0))   # fill depth ~5 m
    assert result_of(rows, "C4:riv") == V.PASS


def test_c4_fail_fill_depth():
    rows = V.check_c4(_c4_ctx(floor=50.0))   # fill depth ~50 m
    row = [r for r in rows if r.item == "C4:riv"][0]
    assert row.result == V.FAIL
    assert "fill depth" in row.detail


def test_c4_fail_misses_terminus():
    ctx = _c4_ctx()
    ctx.manifest["chokepoints"]["neck"]["coords"] = [5, 5]
    assert result_of(V.check_c4(ctx), "C4:riv") == V.FAIL


def test_c4_skip_when_relief_false():
    ctx = _c4_ctx()
    ctx.relief = False
    rows = V.check_c4(ctx)
    assert rows[0].result == V.SKIP and "relief" in rows[0].detail


# ---------------------------------------------------------------------------
# C5: ndjadi outlet and distributaries
# ---------------------------------------------------------------------------

def _c5a_ctx(slopes_east=False):
    rows, cols = 40, 40
    elev = np.zeros((rows, cols))
    yy, xx = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    if slopes_east:
        # land only, draining east: no trace ends in Basin water at all
        elev = (40 - xx) * 10.0
        basin = basin_manifest(0, 0, 40, 8)
    else:
        elev = (yy - 8) * 10.0               # drains north into the basin
        elev[:8, :] = WATER
        basin = basin_manifest(0, 0, 40, 8)
    cons = {"rivers": {},
            "ndjadi_outlet": {"floodplain": "civilizations.ndjadi",
                              "core_erode_u": 6, "outlet_near": "ki_mbuhari",
                              "outlet_r_u": 90, "neck": "the_neck", "neck_r_u": 12}}
    man = _merge(
        {"civilizations": {"ndjadi": {"polygon": [[10, 20], [30, 20], [30, 36], [10, 36]]}}},
        _merge(basin,
               points_manifest(ki_mbuhari=(20, 4), the_neck=(20, 18))))
    return make_ctx(elev, cons=cons, man=man)


def test_c5a_pass():
    rows = V.check_c5(_c5a_ctx())
    assert result_of(rows, "C5a:ocean") == V.PASS
    assert result_of(rows, "C5a:basin") == V.PASS
    assert result_of(rows, "C5a:neck") == V.PASS


def test_c5a_fail_nothing_reaches_basin():
    rows = V.check_c5(_c5a_ctx(slopes_east=True))
    assert result_of(rows, "C5a:basin") == V.FAIL


def _c5b_ctx(bump=False):
    rows, cols = 40, 30
    elev = flat(rows, cols, 20.0)
    elev[:7, :] = WATER                      # basin water
    elev[7:31, 15] = 5.0                     # carved channel (land, per spec B)
    if bump:
        elev[20, 15] = 15.0                  # 10 m mid-channel climb
    cons = {"rivers": {"d1": {"kind": "distributary"}},
            "defaults": {"max_uphill_m": 3, "bank_u": 2}}
    man = _merge(basin_manifest(0, 0, 30, 7),
                 {"rivers": {"d1": {"path": [[15, 30], [15, 6]]}}})
    return make_ctx(elev, cons=cons, man=man)


def test_c5b_pass():
    rows = V.check_c5(_c5b_ctx())
    assert result_of(rows, "C5b:d1") == V.PASS


def test_c5b_fail_uphill():
    rows = V.check_c5(_c5b_ctx(bump=True))
    row = [r for r in rows if r.item == "C5b:d1"][0]
    assert row.result == V.FAIL
    assert "uphill" in row.detail


def _c5c_ctx(wall=False):
    rows, cols = 40, 40
    elev = np.zeros((rows, cols))
    yy, xx = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    if wall:
        elev[:, :] = 100.0
        elev[10, :] = 1000.0                 # closed wall north of the neck
    else:
        elev = (yy - 8) * 10.0
    elev[:8, :] = WATER
    cons = {"ndjadi_outlet": {"floodplain": "civilizations.ndjadi",
                              "core_erode_u": 6, "outlet_near": "ki_mbuhari",
                              "outlet_r_u": 90, "neck": "the_neck", "neck_r_u": 12},
            "rivers": {}}
    man = _merge(
        {"civilizations": {"ndjadi": {"polygon": [[10, 20], [30, 20], [30, 36], [10, 36]]}}},
        _merge(basin_manifest(0, 0, 40, 8),
               points_manifest(ki_mbuhari=(20, 4), the_neck=(20, 20))))
    return make_ctx(elev, cons=cons, man=man)


def test_c5c_pass():
    rows = V.check_c5(_c5c_ctx())
    assert result_of(rows, "C5c") == V.PASS


def test_c5c_fail_wall():
    rows = V.check_c5(_c5c_ctx(wall=True))
    row = [r for r in rows if r.item == "C5c"][0]
    assert row.result == V.FAIL


# ---------------------------------------------------------------------------
# C6: hard-line profiles
# ---------------------------------------------------------------------------

def _c6_ctx(relief=True, north_band=(50, 150), south_band=(0, 30)):
    rows, cols = 40, 60
    elev = flat(rows, cols, 10.0)
    elev[:20, :] = 100.0                     # north of the line
    elev[35:, :] = WATER                     # water to the south
    geo = {"lines": {"wall": [[10, 20], [50, 20]]}}
    cons = {"lines": {
        "wall_line": {
            "geometry": "wall",
            "sides": [{"toward": "N", "offset_u": [2, 4], "stat": "median",
                       "elevation_m": list(north_band)},
                      {"toward": "S", "offset_u": [2, 4], "stat": "median",
                       "elevation_m": list(south_band)}],
            "on_line": {"stat": "max", "elevation_m": [50, 150]},
            "water_within_u": {"toward": "S", "max_u": 60}},
    }}
    return make_ctx(elev, cons=cons, geo=geo, relief=relief)


def test_c6_sides_and_on_line_and_water_pass():
    rows = V.check_c6(_c6_ctx())
    assert result_of(rows, "C6:wall_line:side-N") == V.PASS
    assert result_of(rows, "C6:wall_line:side-S") == V.PASS
    assert result_of(rows, "C6:wall_line:on_line") == V.PASS
    assert result_of(rows, "C6:wall_line:water_within") == V.PASS


def test_c6_fail_wrong_band():
    rows = V.check_c6(_c6_ctx(north_band=(0, 30)))
    assert result_of(rows, "C6:wall_line:side-N") == V.FAIL


def test_c6_relief_false_skips_elevation_but_keeps_water():
    rows = V.check_c6(_c6_ctx(relief=False))
    assert result_of(rows, "C6:wall_line:side-N") == V.SKIP
    assert result_of(rows, "C6:wall_line:on_line") == V.SKIP
    assert result_of(rows, "C6:wall_line:water_within") == V.PASS


def test_c6_zero_stations_skip():
    ctx = _c6_ctx()
    ctx.constraints["lines"]["wall_line"]["x_range"] = [100, 110]
    rows = V.check_c6(ctx)
    assert all(r.result == V.SKIP and r.detail for r in rows)


# ---------------------------------------------------------------------------
# C8: water topology and coast
# ---------------------------------------------------------------------------

def _c8_elev(extra_water=None, land_bridge=None, second_strip=False):
    rows, cols = 40, 60
    # canon: west block (a, x<=24), east block (b1, 26<=x<=46), basin = north
    # band y<10, ocean strip x in [24,26] joining the basin to the south
    # ocean; second_strip opens another at x in [46,48]
    elev = flat(rows, cols, WATER)
    elev[10:, :24] = LAND
    elev[10:, 26:] = LAND
    if second_strip:
        elev[10:, 48:50] = WATER             # a second mouth the cut cannot close
    if extra_water is not None:
        for r0, r1, c0, c1 in extra_water:
            elev[r0:r1, c0:c1] = WATER
    if land_bridge is not None:
        for r0, r1, c0, c1 in land_bridge:
            elev[r0:r1, c0:c1] = LAND
    return elev


def _c8_ctx(elev):
    cons = {"coast": {"mouth_cut": {"point": "halkar_port", "r_u": 5},
                      "basin_area_tol": 0.15, "coast_band_u": 2,
                      "min_agree": 0.97, "free_zones": []}}
    man = _merge(
        {"civilizations": {
            "a": {"polygon": [[0, 10], [24, 10], [24, 40], [0, 40]]},
            "b1": {"polygon": [[26, 10], [60, 10], [60, 40], [26, 40]]}}},
        _merge(basin_manifest(0, 0, 60, 10), points_manifest(halkar_port=(25, 5))))
    return make_ctx(elev, cons=cons, man=man)


def test_c8a_pass():
    rows = V.check_c8(_c8_ctx(_c8_elev()))
    assert result_of(rows, "C8a:connectivity") == V.PASS
    assert result_of(rows, "C8a:area") == V.PASS


def test_c8a_fail_connectivity_and_area():
    # land bridge splits the basin; largest half is 50% and half the area
    rows = V.check_c8(_c8_ctx(_c8_elev(land_bridge=[(4, 6, 0, 60)])))
    assert result_of(rows, "C8a:connectivity") == V.FAIL


def test_c8b_pass():
    rows = V.check_c8(_c8_ctx(_c8_elev()))
    assert result_of(rows, "C8b:mouth") == V.PASS


def test_c8b_fail_second_channel():
    # a second ocean strip at x 44..46 connects the basin to the south ocean
    # and survives the mouth cut at (25,5)
    rows = V.check_c8(_c8_ctx(_c8_elev(second_strip=True)))
    assert result_of(rows, "C8b:mouth") == V.FAIL


def test_c8c_pass():
    rows = V.check_c8(_c8_ctx(_c8_elev()))
    assert result_of(rows, "C8c:land") == V.PASS
    assert result_of(rows, "C8c:water") == V.PASS


def test_c8c_fail_land_agreement():
    # flood interior canon land: agreement drops below 0.97
    rows = V.check_c8(_c8_ctx(_c8_elev(extra_water=[(15, 23, 5, 13)])))
    assert result_of(rows, "C8c:land") == V.FAIL


# ---------------------------------------------------------------------------
# C9: region cores
# ---------------------------------------------------------------------------

def _c9_ctx(relief=True, band=(50, 150)):
    rows, cols = 40, 40
    elev = flat(rows, cols, 10.0)
    elev[5:35, 5:35] = 100.0
    cons = {"region_cores": {"core_a": {"shape": "civilizations.a", "erode_u": 5,
                                        "p50": list(band)}}}
    man = {"civilizations": {"a": {"polygon": [[5, 5], [35, 5], [35, 35], [5, 35]]}}}
    return make_ctx(elev, cons=cons, man=man, relief=relief)


def test_c9_pass():
    assert result_of(V.check_c9(_c9_ctx()), "C9:core_a") == V.PASS


def test_c9_fail():
    assert result_of(V.check_c9(_c9_ctx(band=(200, 300))), "C9:core_a") == V.FAIL


def test_c9_skip_when_relief_false():
    rows = V.check_c9(_c9_ctx(relief=False))
    assert rows[0].result == V.SKIP and "relief" in rows[0].detail


# ---------------------------------------------------------------------------
# Real-data resolution: every ID referenced by the constraints must resolve
# ---------------------------------------------------------------------------

def test_real_constraints_ids_resolve():
    constraints = canon.load_constraints(canon.DATA_DIR / "terrain-constraints.yaml")
    manifest = canon.load_manifest(canon.DATA_DIR / "coordinate-manifest.yaml")
    geometry = canon.load_geometry(canon.DATA_DIR / "terrain-geometry.yaml")

    for pid in constraints.get("points", {}):
        canon.resolve_point(manifest, pid)

    for rid, entry in constraints.get("rivers", {}).items():
        river = manifest.get("rivers", {}).get(rid)
        assert river and "path" in river, f"river {rid} missing from manifest"
        if entry.get("kind") == "convergent":
            term = entry.get("terminus", {})
            if "disk" in term:
                canon.resolve_point(manifest, term["disk"])
            if "water" in term and "near" in term:
                canon.resolve_point(manifest, term["near"])

    for rid, entry in constraints.get("routes", {}).items():
        parts = canon.resolve_route_parts(manifest, rid)
        assert parts, f"route {rid} has no parts"
        for sid in entry.get("stops", []):
            canon.resolve_point(manifest, sid["id"] if isinstance(sid, dict) else sid)
        for part in entry.get("parts", []):
            for sid in part.get("stops", []):
                canon.resolve_point(manifest, sid["id"] if isinstance(sid, dict) else sid)

    for name, entry in constraints.get("lines", {}).items():
        assert entry.get("geometry") in geometry.get("lines", {}), \
            f"line {name} geometry key missing"

    for name, entry in constraints.get("region_cores", {}).items():
        geom = canon.resolve_shape(manifest, geometry, entry["shape"])
        assert not geom.is_empty, f"region core {name} erodes to nothing"

    outlet = constraints.get("ndjadi_outlet", {})
    if outlet:
        canon.resolve_shape(manifest, geometry, outlet["floodplain"])
        canon.resolve_point(manifest, outlet["outlet_near"])
        canon.resolve_point(manifest, outlet["neck"])

    coast = constraints.get("coast", {})
    if coast.get("mouth_cut"):
        canon.resolve_point(manifest, coast["mouth_cut"]["point"])

    basin_ref = constraints.get("water_bodies", {}).get("basin", {}).get("manifest")
    if basin_ref:
        canon.resolve_shape(manifest, geometry, basin_ref)


# ---------------------------------------------------------------------------
# Canon mask bundle + CLI end-to-end
# ---------------------------------------------------------------------------

def test_canon_mask_bundle_and_validate(tmp_path):
    manifest = canon.load_manifest(canon.DATA_DIR / "coordinate-manifest.yaml")
    geometry = canon.load_geometry(canon.DATA_DIR / "terrain-geometry.yaml")
    outdir = tmp_path / "canonb"
    canon_mask.write_bundle(outdir, manifest, geometry)
    bundle = V.load_bundle(outdir)
    assert bundle.ppu == 2 and bundle.relief is False
    assert bundle.elevation.shape == (1600, 2400)
    vals = set(np.unique(bundle.elevation).tolist())
    assert vals == {-50.0, 100.0}

    constraints = canon.load_constraints(canon.DATA_DIR / "terrain-constraints.yaml")
    ctx = V.Context(elev=bundle.elevation.astype(np.float64), ppu=2, relief=False,
                    sea_level=0.0, constraints=constraints, manifest=manifest,
                    geometry=geometry, bundle_path=str(outdir))
    # C1 must run and produce rows without crashing (FAILs are canon findings)
    rows = V.check_c1(ctx)
    assert rows and all(r.result in (V.PASS, V.FAIL, V.SKIP) for r in rows)
    # C6 elevation tests SKIP on a relief:false bundle, water_within runs
    for r in V.check_c6(ctx):
        if r.result == V.SKIP:
            assert r.detail


def test_cli_end_to_end(tmp_path):
    bundle_dir = _write_bundle(tmp_path / "bundle", dict(GOOD_META, width_u=1200, height_u=800),
                               flat(800, 1200))
    constraints = tmp_path / "constraints.yaml"
    constraints.write_text(yaml.safe_dump({
        "points": {"p": {"class": "inland"}},
    }), encoding="utf-8")
    manifest = tmp_path / "manifest.yaml"
    manifest.write_text(yaml.safe_dump(
        {"chokepoints": {"p": {"coords": [10, 7]}}}), encoding="utf-8")
    geometry = tmp_path / "geometry.yaml"
    geometry.write_text("{}", encoding="utf-8")

    md_out = tmp_path / "report.md"
    json_out = tmp_path / "report.json"
    code = V.main([str(bundle_dir), "--constraints", str(constraints),
                   "--manifest", str(manifest), "--geometry", str(geometry),
                   "--checks", "C1", "--md", str(md_out), "--json", str(json_out)])
    assert code == 0
    md = md_out.read_text(encoding="utf-8")
    assert "## C1" in md and "| item | result | detail |" in md
    doc = json.loads(json_out.read_text(encoding="utf-8"))
    assert doc["checks"]["C1"]["result"] == "PASS"

    # a failing check exits 1
    np.save(bundle_dir / "elevation.npy",
            np.full((800, 1200), WATER, dtype=np.float32))
    code = V.main([str(bundle_dir), "--constraints", str(constraints),
                   "--manifest", str(manifest), "--geometry", str(geometry),
                   "--checks", "C1"])
    assert code == 1


def test_cli_preflight_rejects(tmp_path, capsys):
    _write_bundle(tmp_path / "bundle", dict(GOOD_META, px_per_unit=0), flat(3, 4))
    code = V.main([str(tmp_path / "bundle")])
    assert code == 2
    assert "PREFLIGHT" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Regressions for the Sol code review of 17a9877 (one per finding)
# ---------------------------------------------------------------------------

def test_preflight_rejects_redefined_frame(tmp_path):
    """Spec B: the frame is fixed at 1200x800; a bundle may not redefine it."""
    _write_bundle(tmp_path, GOOD_META, flat(3, 4))
    with pytest.raises(V.PreflightError, match="frame"):
        V.load_bundle(tmp_path)


def test_c8b_fail_small_leaking_fragment():
    """A small Basin fragment still joined to the ocean after the cut must FAIL."""
    elev = flat(12, 14)
    elev[1:9, 1:5] = WATER          # basin reservoir
    elev[5, 5:14] = WATER           # channel from the reservoir east to the ocean
    elev[:, 13] = WATER             # ocean column outside the basin polygon
    cons = {"coast": {"mouth_cut": {"point": "m", "r_u": 0.6}}}
    man = _merge(basin_manifest(0, 0, 8, 10), points_manifest(m=(5.5, 5.5)))
    rows = V.check_c8(make_ctx(elev, cons=cons, man=man))
    assert result_of(rows, "C8b:mouth") == V.FAIL


def test_c6_joint_requires_tests_together():
    """Each side passes 4/5 stations, but only 3/5 jointly: the joint row FAILs."""
    elev = flat(11, 9, 100.0)
    elev[4, 3] = 0.0    # north of station x=3.5 fails
    elev[6, 4] = 0.0    # south of station x=4.5 fails
    geo = {"lines": {"l": [[2.5, 5.5], [6.5, 5.5]]}}
    cons = {"lines": {"l": {"geometry": "l", "station_u": 1, "sides": [
        {"toward": "N", "offset_u": [1, 1], "stat": "max", "elevation_m": [100, 100]},
        {"toward": "S", "offset_u": [1, 1], "stat": "max", "elevation_m": [100, 100]}]}}}
    rows = V.check_c6(make_ctx(elev, cons=cons, geo=geo))
    assert result_of(rows, "C6:l:side-N") == V.PASS
    assert result_of(rows, "C6:l:side-S") == V.PASS
    assert result_of(rows, "C6:l:joint") == V.FAIL


def test_c6_single_station_has_real_perpendicular():
    """One station: the side sample must leave the line, not reread the station."""
    elev = flat(11, 11, 100.0)
    elev[4, 5] = 0.0    # the pixel one unit north of the station
    geo = {"lines": {"l": [[5.5, 5.5], [6.5, 5.5]]}}
    cons = {"lines": {"l": {"geometry": "l", "station_u": 10, "sides": [
        {"toward": "N", "offset_u": [1, 1], "stat": "max", "elevation_m": [100, 100]}]}}}
    rows = V.check_c6(make_ctx(elev, cons=cons, geo=geo))
    assert result_of(rows, "C6:l:side-N") == V.FAIL


def test_c1_shoal_dry_ring_fails():
    """A ring that is almost all land fails even if its little water is the right body."""
    elev = flat(30, 30, 1.0)
    elev[15, 18] = -1.0
    cons = {"points": {"p": {"class": "shoal", "water": "basin", "radius_u": 3}}}
    man = _merge(points_manifest(p=(15.5, 15.5)), basin_manifest(0, 0, 30, 30))
    rows = V.check_c1(make_ctx(elev, cons=cons, man=man))
    assert result_of(rows, "C1:p") == V.FAIL


def test_c4_ocean_terminus_rejects_basin_water():
    elev = np.array([[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, -1]], dtype=float)
    elev = np.repeat(elev, 3, axis=0)
    cons = {"rivers": {"r": {"kind": "convergent",
                             "terminus": {"water": "ocean", "near": "e", "r_u": 2}}},
            "defaults": {"river_head_skip_u": 0, "river_tol_u": 2}}
    man = _merge(_merge({"rivers": {"r": {"path": [[0.5, 1.5], [13.5, 1.5]]}}},
                        basin_manifest(12, 0, 14, 3)), points_manifest(e=(13.5, 1.5)))
    rows = V.check_c4(make_ctx(elev, cons=cons, man=man))
    assert result_of(rows, "C4:r") == V.FAIL


def test_c5c_neck_cell_is_water_fails():
    elev = np.array([[10, -1, 8, 7, -1]] * 3, dtype=float)
    cons = {"ndjadi_outlet": {"floodplain": "civilizations.nd", "neck": "n",
                              "outlet_near": "o", "outlet_r_u": 10}}
    man = _merge(_merge(basin_manifest(4, 0, 5, 3), points_manifest(n=(1.9, 1.5), o=(4.5, 1.5))),
                 {"civilizations": {"nd": {"polygon": [[0, 0], [5, 0], [5, 3], [0, 3]]}}})
    row = V._check_c5c(make_ctx(elev, cons=cons, man=man), cons["ndjadi_outlet"])
    assert row.result == V.FAIL and "containing the neck is water" in row.detail


def test_c5a_southern_trace_ending_on_land_counts():
    """A southern core cell whose trace never reaches water still counts against the neck."""
    elev = flat(20, 20, 50.0)
    elev[:3, :] = WATER                 # basin to the north
    yy = np.arange(20)[:, None] * 1.0
    elev[3:12, :] = (yy[3:12] * 2.0).repeat(20, axis=1)   # drains north
    elev[14:, :] = 5.0                  # southern pit: lower than its rim, stays a sink
    elev[12:14, :] = 60.0
    cons = {"ndjadi_outlet": {"floodplain": "civilizations.nd", "core_erode_u": 0,
                              "outlet_near": "o", "outlet_r_u": 100, "neck": "n", "neck_r_u": 2}}
    man = _merge(_merge(basin_manifest(0, 0, 20, 3), points_manifest(o=(10, 1), n=(10, 12.5))),
                 {"civilizations": {"nd": {"polygon": [[0, 3], [20, 3], [20, 20], [0, 20]]}}})
    rows = V._check_c5a(make_ctx(elev, cons=cons, man=man), cons["ndjadi_outlet"])
    neck = [r for r in rows if r.item == "C5a:neck"][0]
    assert neck.result == V.FAIL
