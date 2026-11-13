"""S6 rain, first pass, and erodibility (PHASE3-SPEC section S6).

Erodibility is never keyed to a polygon. It comes from rain and rock.

Rain is a handful of moisture streams. Each has a fixed bearing; the wind
turns along a barrier it cannot climb, the stream rains as it rises and a
little as it travels, and what has fallen is gone. So the wall's face is
wet, the plateau behind the lip is in shadow, and the summer stream that
the wall turns west runs north up Kheshkai's west flank on its own.

The model is solved on a grid `cell_u` coarse and interpolated: rain is a
smooth field, and the solve is a few hundred sweeps.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from .canon import erode_and_clip, rasterize_mask, resolve_shape
from .noise import spectral_field
from .protect import GateError
from .provinces import Provinces, line_offset, smooth01

GATE_S6_ORDER = ("wall_face", "qollari_east_slope", "rim_seaward_face", "ngaru_bon_shelf",
                 "floodplain", "kheshkai_interior", "irrah_north")


@dataclass
class Rain:
    annual: np.ndarray  # coarse, arbitrary units
    seasons: dict[str, np.ndarray]
    norm: np.ndarray  # annual rain scaled to [0, 1]
    report: dict = field(default_factory=dict)


def _block_mean(a: np.ndarray, n: int) -> np.ndarray:
    rows, cols = a.shape
    return a.reshape(rows // n, n, cols // n, n).mean(axis=(1, 3))


def _stream(hs: np.ndarray, water: np.ndarray, source: np.ndarray, from_deg: float,
            cell_u: float, s6: dict) -> np.ndarray:
    """Rain from one stream on the rain grid. `hs` is smoothed terrain (m),
    `source` the stream's moisture over water."""
    rows, cols = hs.shape
    theta = math.radians(from_deg)
    ux0, uy0 = -math.sin(theta), math.cos(theta)  # travel direction, x east, y south
    gy, gx = np.gradient(hs, cell_u)
    climb = ux0 * gx + uy0 * gy  # metres climbed per unit of travel
    norm = np.hypot(gx, gy)
    safe = np.maximum(norm, 1e-9)
    nx, ny = gx / safe, gy / safe
    block = np.clip(climb / float(s6["block_slope_m_per_u"]), 0.0, float(s6["block_max"]))
    into = ux0 * nx + uy0 * ny
    ux = ux0 - block * into * nx
    uy = uy0 - block * into * ny
    speed = np.hypot(ux, uy)
    keep = np.maximum(speed, float(s6["min_speed"])) / np.maximum(speed, 1e-9)
    # a wind blocked head-on has no direction left: it keeps its own bearing, slowly
    dead = speed < 1e-6
    ux = np.where(dead, ux0 * float(s6["min_speed"]), ux * keep)
    uy = np.where(dead, uy0 * float(s6["min_speed"]), uy * keep)
    mag = np.hypot(ux, uy)
    ux, uy = ux / mag, uy / mag

    rr, cc = np.meshgrid(np.arange(rows, dtype=np.float64),
                         np.arange(cols, dtype=np.float64), indexing="ij")
    back = [rr - uy, cc - ux]  # one rain cell upwind, along the turned wind
    # The air is lifted by what its own bearing meets, turned or not: a wind
    # that the wall turns west still rains on the wall.
    rise = np.maximum(hs - ndimage.map_coordinates(hs, [rr - uy0, cc - ux0], order=1,
                                                   mode="nearest"), 0.0)
    # lifted rain thins with height too: the plateau behind the lip is in shadow
    thin = np.exp(-np.maximum(hs, 0.0) / float(s6["lift_scale_height_m"]))
    lift = np.clip(float(s6["uplift_rain_per_m"]) * rise * thin, 0.0, 0.9)
    # travelling rain thins with height: high air is cold and holds little
    base = float(s6["base_rain"]) * cell_u * np.exp(-np.maximum(hs, 0.0)
                                                    / float(s6["base_scale_height_m"]))
    dry = float(s6["dry_air"])
    recharge = min(1.0, float(s6["recharge_per_u"]) * cell_u)
    edge = np.zeros(hs.shape, dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True

    moist = source.copy()
    rain = np.zeros(hs.shape)
    for _ in range(2 * (rows + cols)):
        arriving = ndimage.map_coordinates(moist, back, order=1, mode="nearest")
        # humid air rains as it travels; air drier than dry_air rains only when lifted
        humid = np.clip((arriving - dry) / (1.0 - dry), 0.0, 1.0)
        rain = arriving * np.clip(lift + base * humid, 0.0, 0.9)
        moist = arriving - rain
        moist = np.where(water, moist + (source - moist) * recharge, moist)
        moist = np.where(edge, source, moist)
    return rain


def rain_first_pass(coarse: np.ndarray, water_c: np.ndarray, pv: Provinces,
                    params: dict) -> Rain:
    """Two seasons of moisture streams over the coarse field as it stands."""
    s6 = params["s6"]
    n = int(s6["cell_u"])
    land_h = np.where(water_c, 0.0, coarse)
    hs = _block_mean(ndimage.gaussian_filter(land_h, float(s6["terrain_smooth_u"])), n)
    water = _block_mean(water_c.astype(np.float64), n) >= 0.5

    cold = s6["cold_water"]
    off_coast = ndimage.distance_transform_edt(pv.weights[cold["province"]] < 0.5)
    cold_mask = _block_mean((off_coast <= float(cold["reach_u"])).astype(np.float64), n) >= 0.5

    seasons: dict[str, np.ndarray] = {}
    for name, spec in s6["streams"].items():
        source = np.full(hs.shape, float(spec["moisture"]))
        if name in cold["streams"]:
            source = np.where(cold_mask, float(cold["moisture"]), source)
        rain = _stream(hs, water, source, float(spec["from_deg"]), float(n), s6)
        fine = ndimage.zoom(rain, n, order=1)
        seasons[spec["season"]] = seasons.get(spec["season"], 0.0) + fine
    annual = np.sum(np.stack(list(seasons.values())), axis=0)
    top = float(np.percentile(annual[~water_c], 99.5))
    norm = np.clip(annual / top, 0.0, 1.0)
    return Rain(annual=annual, seasons=seasons, norm=norm)


def erodibility(rain: Rain, pv: Provinces, fixed: np.ndarray, bowls: np.ndarray,
                params: dict, seed: int, k0: float) -> np.ndarray:
    """K = K0 * rock * (rain_floor + rain_norm); zero on `fixed` (water, the
    hydro lock, sinks); a fraction of it in the catchment bowls."""
    s6 = params["s6"]
    lo, hi = (float(v) for v in s6["rock_range"])
    w0, w1 = (float(v) for v in s6["rock_wavelength_u"])
    rock = spectral_field(seed, "s6:rock", 1, [(w0, w1, 1.0)])
    rock = (lo + hi) / 2.0 + (hi - lo) / 2.0 * np.clip(rock / (2.0 * rock.std()), -1.0, 1.0)
    lime = s6["limestone"]
    share = np.clip(sum(pv.weights[name] for name in lime["provinces"]), 0.0, 1.0)
    rock = rock + (float(lime["rock"]) - rock) * share
    k = k0 * rock * (float(s6["rain_floor"]) + rain.norm)
    k = np.where(bowls > 0, k * float(s6["bowl_erodibility"]), k)
    return np.where(fixed, 0.0, k)


def gate_regions(coarse: np.ndarray, water_c: np.ndarray, lk: np.ndarray, pv: Provinces,
                 manifest: dict, geometry: dict, constraints: dict,
                 params: dict) -> dict[str, np.ndarray]:
    """The seven places Gate S6 ranks, each defined by the ground itself or
    by a C9 core."""
    s3 = params["s3"]
    land = ~water_c
    ramp = s3["scarps"]["kheshkai_wall"]["ramp_u"]
    wall = land & (pv.wall_offset >= float(ramp[0])) & (pv.wall_offset <= float(ramp[1]) + 1.0)
    smooth = ndimage.gaussian_filter(np.where(water_c, 0.0, coarse),
                                     float(params["s6"]["terrain_smooth_u"]))
    _gy, gx = np.gradient(smooth)
    q_east = land & (pv.weights["qollari"] > 0.5) & (gx < -float(params["s6"]["slope_min_m_per_u"]))
    offset, _frac = line_offset(geometry["lines"]["southern_rim_crest"])
    reach = float(s3["profiles"]["southern_rim"]["seaward_u"])
    rim_sea = land & (pv.weights["southern_rim"] > 0.5) & (offset < 0) & (offset >= -reach)
    shelf_lo, shelf_hi = (float(v) for v in constraints["regions"]["ngaru_bon"]["shelf_m"])
    shelf = land & (pv.weights["ngaru_bon"] > 0.5) & (coarse >= shelf_lo) & (coarse <= shelf_hi)

    def core(name: str) -> np.ndarray:
        entry = constraints["region_cores"][name]
        shape = erode_and_clip(resolve_shape(manifest, geometry, entry["shape"]),
                               float(entry.get("erode_u", 20)),
                               entry.get("x_range"), entry.get("y_range"))
        return rasterize_mask(shape, 1) & land

    return {"wall_face": wall, "qollari_east_slope": q_east, "rim_seaward_face": rim_sea,
            "ngaru_bon_shelf": shelf, "floodplain": lk & land,
            "kheshkai_interior": core("kheshkai_interior"), "irrah_north": core("irrah_north")}


def gate_s6(rain: Rain, regions: dict[str, np.ndarray]) -> dict:
    """Gate S6: a ranking test, not a number test (spec S6)."""
    means = {}
    for name in GATE_S6_ORDER:
        sel = regions[name]
        if not sel.any():
            raise GateError("S6", f"the region {name!r} is empty: nothing to rank")
        means[name] = float(rain.annual[sel].mean())
    for wetter, drier in zip(GATE_S6_ORDER, GATE_S6_ORDER[1:]):
        if not means[wetter] > means[drier]:
            ranked = ", ".join(f"{name} {means[name]:.4f}" for name in GATE_S6_ORDER)
            raise GateError("S6", f"annual rain: {wetter} is not wetter than {drier} ({ranked})")
    return means
