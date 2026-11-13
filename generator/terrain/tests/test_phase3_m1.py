"""Phase 3 milestone M1: noise, S1 protection sets, S2 land mask and gates.

The real-data tests run at 2 px/unit and share one S1 result (S1 does not
depend on the seed; `canon` and `prot` live in conftest.py), so the module
costs about a minute.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest
from scipy import ndimage

from generator.terrain import mask as M
from generator.terrain import protect as P
from generator.terrain.noise import field_seed, spectral_field

PPU = 2
BANDS = [(40.0, 120.0, 1.0), (6.0, 20.0, 0.25)]


# --- noise -----------------------------------------------------------------

def test_field_seed_is_sha256_prefix():
    digest = hashlib.sha256(b"7:coast").digest()
    assert field_seed(7, "coast") == int.from_bytes(digest[:8], "little")


def test_noise_is_deterministic_and_bounded():
    a = spectral_field(1, "t", 1, BANDS)
    b = spectral_field(1, "t", 1, BANDS)
    assert np.array_equal(a, b)
    assert np.max(np.abs(a)) <= 1.0 + 1e-12
    assert a.shape == (800, 1200)


def test_noise_differs_by_seed_and_by_name():
    a = spectral_field(1, "t", 1, BANDS)
    assert not np.array_equal(a, spectral_field(2, "t", 1, BANDS))
    assert not np.array_equal(a, spectral_field(1, "u", 1, BANDS))


def test_noise_upsamples_the_same_field():
    coarse = spectral_field(1, "t", 1, BANDS)
    fine = spectral_field(1, "t", 2, BANDS)
    assert fine.shape == (1600, 2400)
    assert np.max(np.abs(fine)) <= 1.0 + 1e-12
    pooled = fine.reshape(800, 2, 1200, 2).mean(axis=(1, 3))
    assert np.corrcoef(pooled.ravel(), coarse.ravel())[0, 1] > 0.99


def test_anisotropy_changes_the_field():
    iso = spectral_field(1, "t", 1, BANDS)
    aniso = spectral_field(1, "t", 1, BANDS, anisotropy_deg=30.0)
    assert not np.array_equal(iso, aniso)


# --- real data: S1 and S2 ----------------------------------------------------

@pytest.fixture(scope="module", params=[1, 2])
def stages(request, canon, prot):
    # build_mask runs Gates S2a and S2 (validator C1, C3, C8) and raises on failure.
    return M.build_mask(prot, canon["manifest"], canon["geometry"],
                        canon["constraints"], canon["params"], request.param)


def test_s1_sets_are_disjoint_and_nonempty(prot):
    assert prot.p_land.any() and prot.p_water.any()
    assert not (prot.p_land & prot.p_water).any()


def test_protected_pixels_keep_their_class(prot, stages):
    final = stages["final"]
    assert final[prot.p_land].all()
    assert not final[prot.p_water].any()


def test_base_mask_passes_gate_s2a(canon, prot, stages):
    M.gate_s2a(stages["base"], prot, canon["constraints"],
               canon["manifest"], canon["geometry"])


def test_basin_water_stays_inside_the_polygon(prot, stages):
    """C8b's rule, checked directly: after the mouth cut, no water joined to
    Basin water lies outside the Basin polygon."""
    water = ~stages["final"] & ~prot.mouth_cut
    labels, _ = ndimage.label(water, structure=M.CONN4)
    basin_labels = np.unique(labels[water & prot.in_basin_poly])
    joined = np.isin(labels, basin_labels[basin_labels > 0])
    assert not (joined & ~prot.in_basin_poly).any()


def test_nine_islands(stages):
    _, n = ndimage.label(stages["final"], structure=M.CONN8)
    assert n - 1 == M.EXPECTED_ISLANDS


def test_seeds_give_different_coasts_same_seed_same_mask(canon, prot):
    args = (prot, canon["manifest"], canon["constraints"], canon["params"])
    base = M.base_mask(prot)
    one = M.add_coast_noise(base, *args, 1)
    again = M.add_coast_noise(base, *args, 1)
    two = M.add_coast_noise(base, *args, 2)
    assert np.array_equal(one, again)
    assert not np.array_equal(one, two)


# --- gates fail when they should --------------------------------------------

def test_gate_s1_fails_on_overlap():
    land = np.zeros((4, 4), dtype=bool)
    water = np.zeros((4, 4), dtype=bool)
    land[1, 1] = water[1, 1] = True
    with pytest.raises(P.GateError) as exc:
        P.gate_s1_disjoint(land, water)
    assert exc.value.gate == "S1"


def test_gate_s2a_fails_on_a_basin_leak(canon, prot, stages):
    """Cut a channel through the north arm: Basin water now joins the ocean
    outside the mouth-cut disk."""
    leaky = stages["base"].copy()
    rows, cols = np.nonzero(prot.in_basin_poly & ~prot.mouth_cut)
    col = int(np.median(cols))
    top = int(rows[cols == col].min())
    leaky[:top + 1, col:col + 2] = False
    with pytest.raises(P.GateError) as exc:
        M.gate_s2a(leaky, prot, canon["constraints"],
                   canon["manifest"], canon["geometry"])
    assert exc.value.gate == "S2a"


def test_gate_s2_topology_fails_on_an_extra_island(stages):
    extra = stages["final"].copy()
    extra[2:8, 2:8] = True  # open ocean, top-left corner of the frame
    assert not stages["final"][0:10, 0:10].any()
    with pytest.raises(P.GateError) as exc:
        M.gate_s2_topology(extra, PPU)
    assert exc.value.gate == "S2"


def test_gate_s2_validator_fails_when_a_port_is_drowned(canon, prot, stages):
    """Flood everything within 12 u of Ki-Mbuhari: its coast disk has no land."""
    from generator.terrain.canon import resolve_point
    x, y = resolve_point(canon["manifest"], "ki_mbuhari")
    drowned = stages["final"].copy()
    drowned[P._disk_raster(drowned.shape, PPU, x, y, 12.0)] = False
    with pytest.raises(P.GateError) as exc:
        M.gate_s2_validator(drowned, PPU, canon["constraints"],
                            canon["manifest"], canon["geometry"])
    assert exc.value.gate == "S2"
    assert "ki_mbuhari" in str(exc.value)


def test_gate_s2_one_basin_fails_on_a_cut_off_pool(prot, stages):
    """Wall off a strip of Basin water with land: two components hold Basin water."""
    split = stages["final"].copy()
    rows, cols = np.nonzero(prot.in_basin_poly & ~stages["final"] & ~prot.mouth_cut)
    col = int(np.median(cols))
    split[:, col:col + 2] = True
    with pytest.raises(P.GateError) as exc:
        M.gate_s2_one_basin(split, prot)
    assert exc.value.gate == "S2"


def test_free_zone_follows_the_coast_heading(canon):
    """A coast that enters the zone falling one row per column keeps falling."""
    ppu = 1
    mask = np.zeros((60, 100), dtype=bool)
    for c in range(80):
        mask[: 10 + c // 2, c] = True  # land above a coast that drops 0.5 row/col
    zone = {"free_zones": [{"name": "t", "x_range": [80, 100], "y_range": [0, 60]}]}
    M.apply_free_zones(mask, zone, ppu, canon["params"])
    edge_row = int(mask[:, 79].sum())
    far_row = int(mask[:, 99].sum())
    assert far_row - edge_row == pytest.approx(10, abs=2)
    assert mask[0, 99] and not mask[59, 99]
