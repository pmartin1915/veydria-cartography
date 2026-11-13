"""S2: land mask and coastline (PHASE3-SPEC section S2).

Steps (spec order): base mask, Halkar throat, free zone, Gate S2a (C8b on the
base mask, before the noise), bounded one-sided coastline noise on the signed
distance field, 4-connected topology cleanup, Gate S2 (the validator on a
flat bundle of the final mask, plus the island and Basin component counts).

Protected pixels keep their class: the noise amplitude is zero on P_land and
P_water, and the signed distance field cannot change faster than 1 per unit,
so a protected pixel cannot be crossed by the displaced coast.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import validate as V
from .canon import resolve_point
from .noise import spectral_field
from .params import f
from .protect import GateError, Protection, _disk_raster  # noqa: F401  (GateError re-exported)

CONN4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=int)  # as C8
CONN8 = np.ones((3, 3), dtype=int)  # as C1 island

# Rows permitted to FAIL Gate S2 on the M1 flat bundle (spec S2 gate): the
# two shoals need a relief band, and the caldera is expected to pass because
# the S1 pool exists in the mask (PHASE3-SPEC S9).
ALLOWED_GATE_S2_FAILS = {"C1:qhabal_ur", "C1:tavakh_rubat", "C1:first_caldera"}

EXPECTED_ISLANDS = 9  # the eight drawn plus Kelata-Tamu (spec S2 gate)


def _smooth01(t):
    """Cubic smoothstep on [0, 1]."""
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def flat_elevation(mask: np.ndarray) -> np.ndarray:
    """The M1 flat bundle raster: land +100 m, water -50 m (spec D / S2 gate)."""
    return np.where(mask, 100.0, -50.0).astype(np.float32)


def base_mask(prot: Protection) -> np.ndarray:
    """S2.1: canon mask, add P_land, remove P_water."""
    mask = prot.canon_land | prot.p_land
    mask &= ~prot.p_water
    return mask


def apply_throat(mask: np.ndarray, prot: Protection, manifest: dict,
                 constraints: dict, params: dict) -> None:
    """S2.2: the Halkar throat (exact footprint of PHASE3-SPEC S2.2).

    For |x - px| <= 20 the allowed water half-width is
    ``w(x) = t/2 + (W(x)/2 - t/2) * smooth(|x - px| / 20)`` with
    ``t = strait_throat_u`` and W(x) the canon mouth's north-south width at
    that x: the contiguous canon-water run holding the strait pin row.
    Canon water of that run with |y - py| > w(x) becomes land, unless it is
    in P_water (P_land wins over both). Nothing east of px + 20 changes.
    """
    strait = [pid for pid, e in constraints.get("points", {}).items()
              if e.get("class") == "strait"]
    if not strait:
        return
    px, py = resolve_point(manifest, strait[0])
    ppu = prot.ppu
    t = float(params.get("strait_throat_u", 5))
    half_span = f(params, "s2", "throat_half_span_u")
    canon_water = ~prot.canon_land
    rows, cols = mask.shape
    c_lo = max(0, int(np.ceil((px - half_span) * ppu)))
    c_hi = min(cols - 1, int(np.floor((px + half_span) * ppu)))
    py_row = min(max(int(py * ppu), 0), rows - 1)
    for c in range(c_lo, c_hi + 1):
        x = (c + 0.5) / ppu
        col_water = canon_water[:, c]
        if not col_water[py_row]:
            continue
        y0 = py_row
        while y0 - 1 >= 0 and col_water[y0 - 1]:
            y0 -= 1
        y1 = py_row
        while y1 + 1 < rows and col_water[y1 + 1]:
            y1 += 1
        width_u = (y1 - y0 + 1) / ppu
        w = t / 2.0 + (width_u / 2.0 - t / 2.0) * \
            float(_smooth01(abs(x - px) / half_span))
        centres = (np.arange(y0, y1 + 1) + 0.5) / ppu
        kill = (centres < py - w) | (centres > py + w)
        if not kill.any():
            continue
        # killed canon water becomes land unless it is in P_water (mask True
        # is land; P_land pixels are disjoint from P_water and stay land).
        pwater = prot.p_water[y0:y1 + 1, c]
        segment = mask[y0:y1 + 1, c]
        segment[kill] = ~pwater[kill]
        mask[y0:y1 + 1, c] = segment


def apply_free_zones(mask: np.ndarray, constraints: dict, ppu: int,
                     params: dict) -> None:
    """S2.3 (D7): inside free zones, land continues to the frame.

    Each coastline that enters a zone is extended along its last heading. A
    coastline is a land/water change in the column just west of the zone. Its
    heading is the row shift of the matching change `free_zone_heading_u`
    further west. Inside the zone every column repeats the edge column's
    land/water pattern with each change shifted along its heading. The canon
    mask asserts nothing here (C8c excludes free zones).
    """
    rows, cols = mask.shape
    look = max(1, int(round(f(params, "s2", "free_zone_heading_u") * ppu)))
    match = f(params, "s2", "free_zone_match_u") * ppu
    for zone in constraints.get("free_zones", []):
        x_range = zone.get("x_range")
        y_range = zone.get("y_range")
        if not x_range or not y_range:
            continue
        r_lo = max(0, int(np.floor(y_range[0] * ppu)))
        r_hi = min(rows, int(np.ceil(y_range[1] * ppu)))
        c_start = max(0, int(np.floor(float(x_range[0]) * ppu)))
        c_end = min(cols, int(np.ceil(float(x_range[1]) * ppu)))
        if c_end <= c_start or r_hi <= r_lo or c_start - 1 - look < 0:
            continue
        edge = mask[r_lo:r_hi, c_start - 1].copy()
        back = mask[r_lo:r_hi, c_start - 1 - look]
        # change k sits between rows k and k+1 of the zone's row window
        edge_changes = np.nonzero(edge[1:] != edge[:-1])[0]
        back_changes = np.nonzero(back[1:] != back[:-1])[0]
        slopes = []
        for k in edge_changes:
            slope = 0.0
            same = back_changes[back[back_changes] == edge[k]] if back_changes.size else back_changes
            if same.size:
                nearest = same[np.argmin(np.abs(same - k))]
                if abs(int(nearest) - int(k)) <= match:
                    slope = (int(k) - int(nearest)) / look  # rows per column
            slopes.append(slope)
        n_rows = r_hi - r_lo
        row_idx = np.arange(n_rows)
        for c in range(c_start, c_end):
            step = c - (c_start - 1)
            shifted = np.sort(np.clip(
                [k + slope * step for k, slope in zip(edge_changes, slopes)],
                -1, n_rows))
            # class of a row = the edge column's class in the same interval
            interval = np.searchsorted(shifted, row_idx - 0.5, side="left")
            classes = np.concatenate([[edge[0]], ~edge[edge_changes]])                 if edge_changes.size else np.array([edge[0]])
            mask[r_lo:r_hi, c] = classes[np.minimum(interval, len(classes) - 1)]


def gate_s2a(base: np.ndarray, prot: Protection, constraints: dict,
             manifest: dict, geometry: dict) -> None:
    """Gate S2a (before the noise): C8b on the base mask, by the validator's
    own `_c8b` — after the mouth cut, no water joined to the Basin lies
    outside the Basin polygon."""
    ctx = V.Context(elev=flat_elevation(base), ppu=prot.ppu, relief=False,
                    sea_level=0.0, constraints=constraints, manifest=manifest,
                    geometry=geometry)
    row = V._c8b(ctx, constraints.get("coast", {}), prot.in_basin_poly, ctx.water)
    if row.result != V.PASS:
        raise GateError("S2a", row.detail)


def _signed_distance(mask: np.ndarray, ppu: int) -> np.ndarray:
    """Signed distance to the coast in units, positive on land."""
    d_land = ndimage.distance_transform_edt(mask)
    d_water = ndimage.distance_transform_edt(~mask)
    d = np.where(mask, d_land, -d_water)
    del d_land, d_water
    return d / ppu


def add_coast_noise(base: np.ndarray, prot: Protection, manifest: dict,
                    constraints: dict, params: dict, seed: int) -> np.ndarray:
    """S2.4: bounded, one-sided coastline noise on the signed distance field.

    The final mask is ``d + n > 0`` with ``|n| <= a`` everywhere and
    ``a = min(a_max, 0.5 * dist_to(P_land or P_water))``: a is zero on
    protected pixels, which therefore keep their class. Basin shore is
    one-sided (n >= 0 within the band outside the mouth-cut disk). Within the
    delta-front zone of any distributary mouth, a = 0.
    """
    ppu = prot.ppu
    d = _signed_distance(base, ppu)

    s2 = params["s2"]
    bands = [
        (float(s2["noise_octave_1_wavelength_u"][0]),
         float(s2["noise_octave_1_wavelength_u"][1]),
         float(s2["noise_octave_1_amp"])),
        (float(s2["noise_octave_2_wavelength_u"][0]),
         float(s2["noise_octave_2_wavelength_u"][1]),
         float(s2["noise_octave_2_amp"])),
    ]
    field = spectral_field(seed, "s2_coast", ppu, bands,
                           beta=float(s2["noise_beta"]))

    protected = prot.protected
    prot_dist = ndimage.distance_transform_edt(~protected) / ppu
    a = np.minimum(float(s2["a_max_u"]),
                   float(s2["amplitude_distance_scale"]) * prot_dist)
    del prot_dist

    # Delta front: a = 0 within the zone of any distributary mouth.
    front_zone = np.zeros(base.shape, dtype=bool)
    for rid, entry in constraints.get("rivers", {}).items():
        if entry.get("kind") != "distributary":
            continue
        path = manifest.get("rivers", {}).get(rid, {}).get("path")
        if path:
            front_zone |= _disk_raster(base.shape, ppu, float(path[-1][0]),
                                       float(path[-1][1]),
                                       f(params, "s2", "delta_front_zone_u"))
    a[front_zone] = 0.0
    del front_zone

    n = a * field

    # Basin shore is one-sided: within the band of the polygon edge, outside
    # the mouth-cut disk, the land may advance into the polygon, never retreat.
    in_poly = prot.in_basin_poly
    edge_in = ndimage.distance_transform_edt(in_poly)
    edge_out = ndimage.distance_transform_edt(~in_poly)
    edge_dist = np.where(in_poly, edge_in, edge_out) / ppu
    del edge_in, edge_out
    one_sided = (edge_dist <= f(params, "s2", "basin_one_sided_band_u")) & \
        ~prot.mouth_cut
    n = np.where(one_sided, np.maximum(n, 0.0), n)
    del edge_dist, one_sided

    final = (d + n) > 0.0
    del d, n
    return final


def topology_cleanup(mask: np.ndarray, prot: Protection, params: dict) -> np.ndarray:
    """S2.5: 4-connected topology cleanup, as C8 is (all 4-connected).

    Remove land components under `min_island_area_u2` that hold no protected
    pixel; turn water components that touch neither the ocean nor the Basin
    (every component but the largest 4-connected water body) into land;
    re-apply P_land and P_water.
    """
    ppu = prot.ppu
    min_area_px = f(params, "s2", "min_island_area_u2") * ppu * ppu
    protected = prot.protected

    land_labels, _ = ndimage.label(mask, structure=CONN4)
    sizes = np.bincount(land_labels.ravel())
    protected_labels = np.unique(land_labels[protected])
    protected_labels = protected_labels[protected_labels > 0]
    for label in range(1, len(sizes)):
        if sizes[label] < min_area_px and \
                not np.isin(label, protected_labels).any():
            mask[land_labels == label] = False

    water = ~mask
    water_labels, n_water = ndimage.label(water, structure=CONN4)
    if n_water > 1:
        water_sizes = np.bincount(water_labels.ravel())
        water_sizes[0] = 0
        main = int(np.argmax(water_sizes))
        mask = mask | ((water_labels > 0) & (water_labels != main))

    mask |= prot.p_land
    mask &= ~prot.p_water
    return mask


def gate_s2_topology(mask: np.ndarray, ppu: int) -> None:
    """Gate S2 (structure): exactly `EXPECTED_ISLANDS` island land components
    (the eight drawn plus Kelata-Tamu), i.e. one mainland plus nine islands."""
    labels, n = ndimage.label(mask, structure=CONN8)
    if n == 0:
        raise GateError("S2", "no land at all")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    largest = int(np.argmax(sizes))
    islands = n - 1
    if islands != EXPECTED_ISLANDS:
        raise GateError(
            "S2",
            f"{islands} island land components (expected {EXPECTED_ISLANDS}: "
            f"the eight drawn plus Kelata-Tamu); largest component {largest}")


def gate_s2_one_basin(mask: np.ndarray, prot: Protection) -> None:
    """Gate S2 (structure): exactly one 4-connected water component holds
    Basin water. C8a alone would let 5% of it sit in cut-off pools."""
    water = ~mask
    labels, _ = ndimage.label(water, structure=CONN4)
    comps = np.unique(labels[water & prot.in_basin_poly])
    comps = comps[comps > 0]
    if len(comps) != 1:
        raise GateError(
            "S2", f"{len(comps)} water components hold Basin water (expected 1)")


def gate_s2_validator(final: np.ndarray, ppu: int, constraints: dict,
                      manifest: dict, geometry: dict) -> dict:
    """Gate S2 (validator): C1, C3, C8 on a flat bundle of the final mask.

    Every row passes except at most the two shoals and the caldera (which
    need relief; the caldera is expected to pass because the S1 pool exists
    in the mask). Any other FAIL is a gate failure.
    """
    ctx = V.Context(elev=flat_elevation(final), ppu=ppu, relief=False,
                    sea_level=0.0, constraints=constraints, manifest=manifest,
                    geometry=geometry)
    results = V.run_checks(ctx, ["C1", "C3", "C8"])
    unexpected = [
        r for rows in results.values() for r in rows
        if r.result == V.FAIL and r.item not in ALLOWED_GATE_S2_FAILS
    ]
    if unexpected:
        detail = "; ".join(f"{r.item}: {r.detail}" for r in unexpected[:8])
        raise GateError("S2", f"unexpected validator FAILs: {detail}")
    return results


def build_mask(prot: Protection, manifest: dict, geometry: dict,
               constraints: dict, params: dict, seed: int) -> dict:
    """Run S2 end to end. Returns stage masks: base (pre-noise) and final."""
    mask = base_mask(prot)
    apply_throat(mask, prot, manifest, constraints, params)
    apply_free_zones(mask, constraints, prot.ppu, params)
    gate_s2a(mask, prot, constraints, manifest, geometry)
    final = add_coast_noise(mask, prot, manifest, constraints, params, seed)
    final = topology_cleanup(final, prot, params)
    gate_s2_topology(final, prot.ppu)
    gate_s2_one_basin(final, prot)
    gate_s2_validator(final, prot.ppu, constraints, manifest, geometry)
    return {"base": mask, "final": final}
