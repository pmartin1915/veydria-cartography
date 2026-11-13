"""S3 provinces and the macro field (PHASE3-SPEC section S3).

A province is a physical unit, not a polity. This is the only module that
reads the civ polygons, and it reads them once, to seed province shapes.
Everything it hands on is a raster on the coarse grid (1 px/unit).

The macro field is built in this order:

1. signed distance to each province shape, bent by one shared domain warp
   (so no straight political edge survives; the warp is zero near a hard
   line and bounded by each C9 core's erosion);
2. province weights from the distances (`score = distance + bias`; a
   province fades out over `soft_u` behind the best score, so a lowland
   keeps its level to its edge and the ramp lies inside the upland);
3. a designed profile per province, of physical coordinates only;
4. scarps: within 12 u of a hard line the cross-profile replaces the
   weighted field;
5. the coast clamp, island cones, relief noise, authored cones, sink
   floors, caps and floors, anchor stamps.

Deviations from the frozen spec are listed in DEVIATIONS and in section 14.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import ndimage
from shapely.geometry import LineString, Point

from . import validate as V
from .canon import (
    FRAME_H_U,
    FRAME_W_U,
    rasterize_mask,
    rect_mask,
    resolve_point,
    resolve_shape,
)
from .noise import spectral_field
from .protect import GateError

ROWS, COLS = FRAME_H_U, FRAME_W_U
SHAPE = (ROWS, COLS)
BOX3 = np.ones((3, 3), dtype=bool)
MARGIN = "margin"  # land that no province shape covers

DEVIATIONS = (
    "S3.2: weights come from one rule (score = signed distance + bias; fade "
    "over soft_u behind the best score) instead of a width per boundary "
    "type. The bias puts a lowland-to-upland ramp inside the upland, so the "
    "macro field meets the hydro lock without a step.",
    "S3.3/S5.1: Apu-Yana's C2 disk lies wholly inside the floodplain polygon, "
    "which S5 locks under 48 m. The cone is built here and its cells leave "
    "the lock set.",
    "S3.7/S4.7: the three sinks get their floor in S3, because Gate S3 asks "
    "C2 of them and S7 needs a base level; S9 still shapes them.",
    "Gate S3 is judged on the composed coarse field (macro plus the S5 "
    "lock), which is the field the validator will see.",
)


def smooth01(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def soft_cap(h: np.ndarray, cap) -> np.ndarray:
    """Smooth clip: values under 95% of the cap are unchanged, and nothing
    passes the cap (spec S3.6)."""
    cap = np.asarray(cap, dtype=np.float64)
    knee, room = 0.95 * cap, 0.05 * cap
    over = np.maximum(h - knee, 0.0)
    return np.where(h > knee, knee + room * np.tanh(over / room), h)


def _cell_centres() -> tuple[np.ndarray, np.ndarray]:
    return np.meshgrid(np.arange(COLS) + 0.5, np.arange(ROWS) + 0.5)


def signed_distance(inside: np.ndarray) -> np.ndarray:
    """Units to the shape's edge, positive inside."""
    if not inside.any():
        return np.full(inside.shape, -1e6)
    din = ndimage.distance_transform_edt(inside)
    dout = ndimage.distance_transform_edt(~inside)
    return np.where(inside, din - 0.5, 0.5 - dout)


def line_distance(points) -> np.ndarray:
    """Units from each cell centre to a polyline (exact, by segment)."""
    xx, yy = _cell_centres()
    best = np.full(SHAPE, np.inf)
    pts = [(float(x), float(y)) for x, y in points]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        length2 = dx * dx + dy * dy
        if length2 <= 0:
            continue
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / length2, 0.0, 1.0)
        best = np.minimum(best, np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy)))
    return best


def line_offset(points) -> tuple[np.ndarray, np.ndarray]:
    """Signed offset from a polyline (positive on the left of its direction
    of travel in the frame's y-down axes, which for a west-to-east line is
    the north side) and the arc fraction of the nearest point."""
    xx, yy = _cell_centres()
    pts = [(float(x), float(y)) for x, y in points]
    seg_len = [math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(pts, pts[1:])]
    total = sum(seg_len)
    best = np.full(SHAPE, np.inf)
    side = np.zeros(SHAPE)
    frac = np.zeros(SHAPE)
    run = 0.0
    for ((x0, y0), (x1, y1)), length in zip(zip(pts, pts[1:]), seg_len):
        if length <= 0:
            continue
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / (length * length), 0.0, 1.0)
        dist = np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy))
        cross = dx * (yy - y0) - dy * (xx - x0)  # negative on the north side of a W-to-E line
        nearer = dist < best
        best = np.where(nearer, dist, best)
        side = np.where(nearer, -np.sign(cross), side)
        frac = np.where(nearer, (run + t * length) / total, frac)
        run += length
    return best * np.where(side == 0, 1.0, side), frac


# ---------------------------------------------------------------------------
# The result
# ---------------------------------------------------------------------------

@dataclass
class Provinces:
    """What S3 fixes, for the stages that follow. All rasters are coarse."""

    macro: np.ndarray  # float64 elevation, defined on every cell
    weights: dict[str, np.ndarray]  # province -> weight in [0, 1], sums to 1 on the mainland
    island: np.ndarray  # land cells off the mainland
    relief_amp: np.ndarray  # metres of relief noise the province mix asks for
    noise_taper: np.ndarray  # 0 at anchors and shores, 1 away from them
    wall_offset: np.ndarray  # units north of the Kheshkai wall line, +inf away from it
    cap: np.ndarray  # soft upper bound per cell
    floor: np.ndarray  # lower bound per cell (-inf where none)
    lock_exempt: np.ndarray  # cells an authored cone takes out of the hydro lock
    bowl_cost: np.ndarray  # catchment-bowl cross-slope multiplier (gorge through a scarp)
    sink_floor: dict[str, float]
    stamps: list[dict] = field(default_factory=list)
    report: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Shapes, warp, weights
# ---------------------------------------------------------------------------

def _hard_lines(geometry: dict, params: dict) -> dict[str, list]:
    return {name: geometry["lines"][name] for name in params["s3"]["scarps"]}


def province_distances(manifest: dict, geometry: dict, constraints: dict,
                       params: dict, seed: int) -> tuple[dict, dict, np.ndarray]:
    """Signed distances to each province shape: (plain, warped, hard-line
    distance). The warp is one shared displacement field, so two provinces
    that share an edge still share it afterwards."""
    s3 = params["s3"]
    plain: dict[str, np.ndarray] = {}
    for name, spec in s3["provinces"].items():
        if name == MARGIN:
            continue
        shape = resolve_shape(manifest, geometry, spec["shape"])
        plain[name] = signed_distance(rasterize_mask(shape, 1))
    # The margin is the land no shape covers. Shapes that share an edge leave
    # slivers between them on the raster; an opening drops those, so the
    # margin never runs along a shared edge. Free zones continue a neighbour (D7).
    covered = np.max(np.stack(list(plain.values())), axis=0) >= 0
    for zone in constraints.get("free_zones", []):
        covered |= rect_mask(1, zone.get("x_range"), zone.get("y_range"), FRAME_W_U, FRAME_H_U)
    opened = ndimage.binary_opening(~covered, structure=BOX3,
                                    iterations=int(s3["margin_min_width_u"]))
    plain[MARGIN] = signed_distance(opened)

    hard = np.full(SHAPE, np.inf)
    for points in _hard_lines(geometry, params).values():
        hard = np.minimum(hard, line_distance(points))

    # warp amplitude: province_warp_u, less near a C9 core that erodes by less
    amp = np.full(SHAPE, float(params["province_warp_u"]))
    reach = 2.0 * float(params["province_warp_u"])
    for entry in constraints.get("region_cores", {}).values():
        limit = min(float(params["province_warp_u"]), float(entry.get("erode_u", 20)) - 3.0)
        if limit >= float(params["province_warp_u"]):
            continue
        sd = signed_distance(rasterize_mask(
            resolve_shape(manifest, geometry, entry["shape"]), 1))
        amp = np.where(np.abs(sd) <= reach, np.minimum(amp, max(limit, 0.0)), amp)
    amp = np.minimum(amp, ndimage.gaussian_filter(amp, 8.0))
    zone = s3["scarp_zone_u"]
    amp = amp * smooth01((hard - float(zone[0])) / (float(zone[1]) - float(zone[0])))

    lo, hi = (float(v) for v in s3["warp_wavelength_u"])
    xx, yy = _cell_centres()
    scale = amp / math.sqrt(2.0)  # |(wx, wy)| <= amp
    wx = scale * spectral_field(seed, "s3:warp_x", 1, [(lo, hi, 1.0)])
    wy = scale * spectral_field(seed, "s3:warp_y", 1, [(lo, hi, 1.0)])
    coords = [yy - 0.5 + wy, xx - 0.5 + wx]
    warped = {name: ndimage.map_coordinates(sd, coords, order=1, mode="nearest")
              for name, sd in plain.items()}
    return plain, warped, hard


def province_weights(warped: dict, params: dict) -> dict[str, np.ndarray]:
    """Weights in [0, 1] that sum to 1.

    A province's score is its signed distance plus its bias; it fades to
    nothing `soft_u` behind the best score. The best score is continuous,
    so the weights are. A province marked `overlay` (the trough) does not
    compete: it holds weight 1 to its own edge and fades over `reach_u`
    outside it, and the others share what is left. So the trough meets every
    neighbour by the same ramp, which lies outside the trough."""
    spec = params["s3"]["provinces"]
    rivals = [name for name in spec if not spec[name].get("overlay")]
    score = {name: warped[name] + float(spec[name]["bias_u"]) for name in rivals}
    best = np.max(np.stack(list(score.values())), axis=0)
    raw = {name: smooth01(1.0 + (score[name] - best) / float(spec[name]["soft_u"]))
           for name in rivals}
    total = np.sum(np.stack(list(raw.values())), axis=0)
    out = {name: value / total for name, value in raw.items()}
    for name in spec:
        if spec[name].get("overlay"):
            over = smooth01(1.0 + warped[name] / float(spec[name]["reach_u"]))
            out = {other: value * (1.0 - over) for other, value in out.items()}
            out[name] = over
    return {name: out[name] for name in spec}


# ---------------------------------------------------------------------------
# Profiles (spec S3.3): elevation as a function of physical coordinates
# ---------------------------------------------------------------------------

def _away_from(warped: dict, names) -> np.ndarray:
    """Units from the nearest of the named provinces (0 inside one)."""
    return np.maximum(-np.max(np.stack([warped[n] for n in names]), axis=0), 0.0)


def province_profiles(warped: dict, dsea: np.ndarray, manifest: dict, geometry: dict,
                      constraints: dict, params: dict) -> dict[str, np.ndarray]:
    prof = params["s3"]["profiles"]
    xx, yy = _cell_centres()
    out: dict[str, np.ndarray] = {}

    # Kheshkai: the lip, rising inland to the interior; lower east of the plain's end
    k = prof["kheshkai"]
    margin = geometry["lines"]["kheshkai_east_margin"]
    x0 = float(margin[0][0])
    span = float(margin[-1][0]) - x0
    t0, t1 = (float(v) for v in k["lip_taper_u"])
    lip = float(k["lip_m"]) - (float(k["lip_m"]) - float(k["lip_east_m"])) * smooth01(
        (xx - (x0 + t0)) / (t1 - t0))
    f0, f1 = (float(v) for v in k["east_drop_span"])
    east = smooth01((xx - (x0 + f0 * span)) / ((f1 - f0) * span))
    interior = np.maximum(float(k["interior_m"]) * (1.0 - float(k["east_drop"]) * east), lip)
    inland = _away_from(warped, k["rises_from"])
    out["kheshkai"] = lip + (interior - lip) * smooth01(inland / float(k["rise_u"]))

    # Ngaru-Bon: the shelf on the south face, then the crown
    n = prof["ngaru_bon"]
    north = _away_from(warped, n["rises_from"])
    out["ngaru_bon"] = (
        float(n["shelf_m"][0])
        + (float(n["shelf_m"][1]) - float(n["shelf_m"][0])) * smooth01(
            (north + float(n["shelf_lead_u"])) / float(n["shelf_u"]))
        + (float(n["crown_m"]) - float(n["shelf_m"][1])) * smooth01(
            (north - float(n["crown_lead_u"])) / float(n["crown_u"])))

    # Qollari: a massif, foothills at its edge
    q = prof["qollari"]
    out["qollari"] = float(q["foot_m"]) + (float(q["massif_m"]) - float(q["foot_m"])) * smooth01(
        np.maximum(warped["qollari"], 0.0) / float(q["rise_u"]))

    # Ndjadi trough: tilted down to the neck (S5 replaces it wholesale)
    d = prof["ndjadi"]
    nx, ny = resolve_point(manifest, constraints["ndjadi_outlet"]["neck"])
    out["ndjadi"] = float(d["low_m"]) + (float(d["high_m"]) - float(d["low_m"])) * smooth01(
        np.hypot(xx - nx, yy - ny) / float(d["tilt_u"]))

    # Southern rim: a crest on the crest line, short seaward face, long landward face
    r = prof["southern_rim"]
    offset, frac = line_offset(geometry["lines"]["southern_rim_crest"])
    e0, e1 = (float(v) for v in r["east_rise_span"])
    crest = float(r["crest_m"]) + (float(r["crest_east_m"]) - float(r["crest_m"])) * smooth01(
        (frac - e0) / (e1 - e0))
    sea_face = float(r["bench_m"]) + (crest - float(r["bench_m"])) * (
        1.0 - smooth01(-offset / float(r["seaward_u"])))
    land_face = float(r["landward_base_m"]) + (crest - float(r["landward_base_m"])) * (
        1.0 - smooth01(offset / float(r["landward_u"])))
    out["southern_rim"] = np.where(offset < 0, sea_face, land_face)

    # Irrah north: a gravel plateau stepping up toward the Ngaru-Bon escarpment
    i = prof["irrah_north"]
    out["irrah_north"] = float(i["plateau_m"]) + float(i["step_m"]) * smooth01(
        1.0 - _away_from(warped, i["steps_toward"]) / float(i["step_u"]))

    # Irrah south-east: thorn-steppe rising to escarpments near the coast
    s = prof["irrah_se"]
    out["irrah_se"] = float(s["steppe_m"]) + float(s["escarpment_m"]) * smooth01(
        1.0 - dsea / float(s["escarpment_u"])) * smooth01(dsea / float(s["shore_u"]))

    # North arm and the unprovinced margin: low hills by distance to the sea
    for name in ("north_arm", MARGIN):
        a = prof[name]
        out[name] = float(a["base_m"]) + float(a["rise_m"]) * smooth01(dsea / float(a["rise_u"]))
    return out


# ---------------------------------------------------------------------------
# Scarps (spec S3.4)
# ---------------------------------------------------------------------------

def apply_scarps(weights: dict, plain: dict, geometry: dict,
                 params: dict) -> tuple[dict, np.ndarray]:
    """Within the scarp zone of a hard line the cross-profile replaces the
    weighted field: the high province's weight becomes the ramp, and the
    others share the rest in their own proportions. The offset is the plain
    (unwarped) signed distance to the high province, so the scarp wraps the
    line's end as a round. Returns (weights, own), own = how far a scarp
    owns each cell."""
    s3 = params["s3"]
    z0, z1 = (float(v) for v in s3["scarp_zone_u"])
    names = list(weights)
    acc = {name: np.zeros(SHAPE) for name in names}
    total = np.zeros(SHAPE)
    strongest = np.zeros(SHAPE)
    for line, spec in s3["scarps"].items():
        high = spec["high"]
        a, b = (float(v) for v in spec["ramp_u"])
        ramp = smooth01((plain[high] - a) / (b - a))
        rest = 1.0 - weights[high]
        # deep on the high side the others carry no weight, and the ramp is 1 there
        ramp = np.where(rest > 1e-6, ramp, 1.0)
        own = 1.0 - smooth01((line_distance(geometry["lines"][line]) - z0) / (z1 - z0))
        for name in names:
            if name == high:
                acc[name] += own * ramp
            else:
                acc[name] += own * weights[name] / np.maximum(rest, 1e-6) * (1.0 - ramp)
        total += own
        strongest = np.maximum(strongest, own)
    out = {}
    for name in names:
        scarp = np.where(total > 0, acc[name] / np.maximum(total, 1e-9), weights[name])
        out[name] = weights[name] * (1.0 - strongest) + scarp * strongest
    return out, strongest


# ---------------------------------------------------------------------------
# Islands, noise, cones, sinks
# ---------------------------------------------------------------------------

def island_cones(water_c: np.ndarray, params: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One cone per island, peak scaled by island radius (spec S3.3 Oravan).
    Returns (island mask, cone heights, relief amplitude)."""
    o = params["s3"]["profiles"]["oravan"]
    labels, count = ndimage.label(~water_c, structure=BOX3)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    mainland = int(np.argmax(sizes))
    island = (labels > 0) & (labels != mainland)
    cone = np.zeros(SHAPE)
    amp = np.zeros(SHAPE)
    xx, yy = _cell_centres()
    for label in range(1, count + 1):
        if label == mainland:
            continue
        sel = labels == label
        radius = math.sqrt(float(sizes[label]) / math.pi)
        cx, cy = float(xx[sel].mean()), float(yy[sel].mean())
        scale = min(1.0, radius / float(o["full_radius_u"]))
        d = np.hypot(xx - cx, yy - cy) / max(radius, 1.0)
        shape = np.clip(1.0 - d, 0.0, 1.0) ** float(o["cone_power"])
        cone = np.where(sel, np.maximum(float(o["shore_m"]), float(o["peak_m"]) * shape * scale),
                        cone)
        amp = np.where(sel, float(o["relief_m"]) * scale, amp)
    return island, cone, amp


def relief_noise(weights: dict, island_amp: np.ndarray, island: np.ndarray,
                 params: dict, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Ridged anisotropic noise, blended by province weight (spec S3.5).
    Returns (noise in metres before tapering, amplitude field)."""
    s3 = params["s3"]
    spec = s3["provinces"]
    lo, hi = (float(v) for v in s3["relief_wavelength_u"])
    beta = float(s3["relief_beta"])
    ridged: dict[Optional[float], np.ndarray] = {}

    def ridge(grain) -> np.ndarray:
        if grain not in ridged:
            n = spectral_field(seed, f"s3:relief:{grain}", 1, [(lo, hi, 1.0)], beta=beta,
                               anisotropy_deg=grain)
            r = np.clip(1.0 - np.abs(n / n.std()), -1.0, 1.0)
            r = np.where(r > 0, np.maximum(r, 0.0) ** 1.5, r)
            ridged[grain] = r - r.mean()
        return ridged[grain]

    low = spectral_field(seed, "s3:relief:low", 1,
                         [(float(v[0]), float(v[1]), 1.0) for v in [s3["relief_low_wavelength_u"]]])
    low = low / low.std() / 3.0
    amp = np.zeros(SHAPE)
    noise = np.zeros(SHAPE)
    for name, entry in spec.items():
        a = weights[name] * float(entry["relief_m"])
        grain = entry.get("grain_deg")
        noise += a * float(s3["relief_ridge_gain"]) * ridge(None if grain is None else float(grain))
        amp += a
    noise = np.where(island, island_amp * float(s3["relief_ridge_gain"]) * ridge(None), noise)
    amp = np.where(island, island_amp, amp)
    noise += float(s3["relief_low_gain"]) * amp * np.clip(low, -1.0, 1.0)
    return noise, amp


def anchor_disks(manifest: dict, constraints: dict) -> np.ndarray:
    """Units from each cell to the nearest C2 anchor disk (0 inside one)."""
    xx, yy = _cell_centres()
    out = np.full(SHAPE, np.inf)
    default = float(constraints.get("defaults", {}).get("point_radius_u", 3))
    for pid, entry in constraints.get("points", {}).items():
        if not entry.get("elevation_m"):
            continue
        x, y = resolve_point(manifest, pid)
        radius = float(entry.get("radius_u", default))
        out = np.minimum(out, np.maximum(np.hypot(xx - x, yy - y) - radius, 0.0))
    return out


def authored_cones(h: np.ndarray, plain: dict, manifest: dict,
                   params: dict) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Cones the contract asks for where a province profile cannot reach
    (Apu-Yana: its C2 disk lies inside the floodplain). The cone stands
    `toward_edge_u` from the pin toward the edge of `leaves`, and its cells
    leave the hydro lock."""
    xx, yy = _cell_centres()
    exempt = np.zeros(SHAPE, dtype=bool)
    listed = []
    for pid, spec in (params["s3"].get("cones") or {}).items():
        x, y = resolve_point(manifest, pid)
        sd = plain[spec["leaves"]]
        r, c = int(y), int(x)
        gy, gx = np.gradient(sd)
        norm = math.hypot(float(gx[r, c]), float(gy[r, c])) or 1.0
        shift = min(float(spec["toward_edge_u"]), max(float(sd[r, c]), 0.0))
        cx = x - shift * float(gx[r, c]) / norm
        cy = y - shift * float(gy[r, c]) / norm
        radius = float(spec["radius_u"])
        d = np.hypot(xx - cx, yy - cy) / radius
        cone = float(spec["peak_m"]) * np.clip(1.0 - d, 0.0, 1.0) ** float(spec["cone_power"])
        disk = d < 1.0
        h = np.where(disk, np.maximum(h, cone), h)
        exempt |= disk
        listed.append({"id": pid, "centre": [round(cx, 2), round(cy, 2)],
                       "radius_u": radius, "cells": int(disk.sum())})
    return h, exempt, listed


def apply_sinks(h: np.ndarray, manifest: dict, constraints: dict,
                params: dict) -> tuple[np.ndarray, dict[str, float]]:
    """A flat floor on each declared sink, an apron back to the field, and
    ground that stands over the floor all round it (S4.7; S9 shapes them)."""
    xx, yy = _cell_centres()
    floors: dict[str, float] = {}
    for sid, spec in params["s4"]["sinks"].items():
        x, y = resolve_point(manifest, sid)
        radius = spec.get("radius_u")
        if radius is None:
            radius = constraints["points"][sid]["extent_u"]
        radius = float(radius)
        floor = float(spec["floor_m"])
        dist = np.hypot(xx - x, yy - y)
        blend = smooth01((dist - radius) / float(spec["apron_u"]))
        out = floor + (h - floor) * blend
        rim = floor + float(spec["rim_m"]) * smooth01((dist - radius) / float(spec["rim_u"]))
        near = dist <= radius + float(spec["apron_u"])
        out = np.where(near & (dist > radius), np.maximum(out, rim), out)
        h = np.where(near, out, h)
        floors[sid] = floor
    return h, floors


# ---------------------------------------------------------------------------
# Caps, floors, anchors (spec S3.6, S3.7)
# ---------------------------------------------------------------------------

def cap_floor_fields(plain: dict, geometry: dict, params: dict) -> tuple[np.ndarray, np.ndarray]:
    """The soft cap and the floor per cell. The caps and floors sit in strips
    beside the hard lines whose C6 bands have that bound."""
    s3 = params["s3"]
    cap = np.full(SHAPE, float(params["cap_all_m"]))
    floor = np.full(SHAPE, -np.inf)
    for name, spec in s3["scarps"].items():
        offset = plain[spec["high"]]
        near = line_distance(geometry["lines"][name])
        if "cap_m" in spec:
            c0, c1 = (float(v) for v in spec["cap_strip_u"])
            fade = float(spec["cap_fade_u"])
            inside = (offset >= c0) & (near <= c1 + fade)
            strip = float(spec["cap_m"]) + (float(params["cap_all_m"]) - float(spec["cap_m"])) * (
                smooth01((np.maximum(offset, near) - c1) / fade))
            cap = np.where(inside, np.minimum(cap, strip), cap)
        if "floor_m" in spec:
            f0, f1 = (float(v) for v in spec["floor_strip_u"])
            fade = float(spec["floor_fade_u"])
            # along the line itself, not round its ends: the distance to the line is the offset there
            along = np.abs(near - np.abs(offset)) < 0.75
            gap = np.maximum(np.maximum(f0 - offset, offset - f1), 0.0)
            level = float(spec["floor_m"]) - float(spec["floor_drop_m"]) * smooth01(gap / fade)
            strip = along & (gap <= fade)
            floor = np.where(strip, np.maximum(floor, level), floor)
    return cap, floor


def apply_caps_floors(h: np.ndarray, cap: np.ndarray, floor: np.ndarray,
                      skip: Optional[np.ndarray] = None) -> np.ndarray:
    out = np.maximum(soft_cap(h, cap), floor)
    return out if skip is None else np.where(skip, h, out)


def apply_anchors(h: np.ndarray, manifest: dict, constraints: dict, params: dict,
                  frozen: Optional[np.ndarray] = None) -> tuple[np.ndarray, list[dict]]:
    """Spec S3.7: where C2's own rule fails on the field, one smooth stamp
    of radius 2 x radius_u moves the disk to the band's nearer third.
    `frozen` cells are never moved."""
    xx, yy = _cell_centres()
    default = float(constraints.get("defaults", {}).get("point_radius_u", 3))
    stamps = []
    h = h.copy()
    for pid, entry in constraints.get("points", {}).items():
        band = entry.get("elevation_m")
        if not band or entry.get("class") == "coast":
            continue  # a coast point's band is met by the shore itself
        lo, hi = float(band[0]), float(band[1])
        x, y = resolve_point(manifest, pid)
        radius = float(entry.get("radius_u", default))
        dist = np.hypot(xx - x, yy - y)
        disk = dist <= radius
        vals = h[disk]
        median = entry.get("sample", "any") == "median"
        if median:
            stat = float(np.median(vals))
            if lo <= stat <= hi:
                continue
            below = stat < lo
        else:
            if ((vals >= lo) & (vals <= hi)).any():
                continue
            below = bool((vals < lo).all())
        third = (hi - lo) / 3.0
        target = lo + third / 2.0 if below else hi - third / 2.0
        gain = 1.0 - smooth01((dist - radius) / radius)
        moved = h + (target - h) * gain
        if frozen is not None:
            moved = np.where(frozen, h, moved)
        h = moved
        stamps.append({"id": pid, "target_m": round(target, 1), "radius_u": 2 * radius})
    limit = int(params["s3"]["max_stamps"])
    if len(stamps) > limit:
        raise GateError("S3", f"{len(stamps)} anchor stamps (limit {limit}): a profile is "
                              f"wrong, fix the profile: {[s['id'] for s in stamps]}")
    return h, stamps


# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------

def build_provinces(water_c: np.ndarray, manifest: dict, geometry: dict,
                    constraints: dict, params: dict, seed: int) -> Provinces:
    """Run S3 on the coarse classes. The gate runs later, on the composed
    field (`gate_s3`)."""
    s3 = params["s3"]
    plain, warped, hard = province_distances(manifest, geometry, constraints, params, seed)
    weights = province_weights(warped, params)
    dsea = ndimage.distance_transform_edt(~water_c)
    profiles = province_profiles(warped, dsea, manifest, geometry, constraints, params)
    weights, scarp_own = apply_scarps(weights, plain, geometry, params)
    h = np.sum(np.stack([weights[n] * profiles[n] for n in weights]), axis=0)

    # the coast clamp: land rises from the sea no faster than coast_slope
    h = np.minimum(h, float(s3["coast_base_m"])
                   + float(s3["coast_slope_m_per_u"]) * np.maximum(dsea - 1.0, 0.0))
    island, cone, island_amp = island_cones(water_c, params)
    h = np.where(island, cone, h)

    noise, amp = relief_noise(weights, island_amp, island, params, seed)
    taper = smooth01(anchor_disks(manifest, constraints) / float(s3["anchor_taper_u"]))
    taper = taper * smooth01(dsea / float(s3["shore_taper_u"]))
    # low ground gets less relief, so noise never digs a plateau down to sea level
    taper = taper * np.minimum(1.0, float(s3["relief_max_share"]) * h / np.maximum(amp, 1e-9))
    h = np.maximum(h + noise * taper, float(s3["min_land_m"]))

    h, exempt, cones = authored_cones(h, plain, manifest, params)
    h, sink_floor = apply_sinks(h, manifest, constraints, params)
    cap, floor = cap_floor_fields(plain, geometry, params)
    h = apply_caps_floors(h, cap, floor)
    h, stamps = apply_anchors(h, manifest, constraints, params)

    wall = s3["scarps"]["kheshkai_wall"]
    wall_near = line_distance(geometry["lines"]["kheshkai_wall"])
    wall_offset = np.where(wall_near <= float(s3["scarp_zone_u"][1]), plain[wall["high"]], np.inf)
    g0, g1 = (float(v) for v in s3["gorge_zone_u"])
    in_scarp = 1.0 - smooth01((hard - g0) / (g1 - g0))
    bowl_cost = 1.0 + (float(s3["gorge_factor"]) - 1.0) * in_scarp

    return Provinces(
        macro=h, weights=weights, island=island, relief_amp=amp, noise_taper=taper,
        wall_offset=wall_offset, cap=cap, floor=floor, lock_exempt=exempt,
        bowl_cost=bowl_cost, sink_floor=sink_floor, stamps=stamps,
        report={"stamps": stamps, "cones": cones,
                "scarp_cells": int((scarp_own > 0.5).sum()),
                "macro_land_range_m": [float(h[~water_c].min()), float(h[~water_c].max())]})


def gate_s3(coarse: np.ndarray, manifest: dict, geometry: dict, constraints: dict) -> dict:
    """Gate S3: C9, C6 and C2 pass, by the validator's own checks, on the
    coarse field. None of the three floods, so this gate is cheap."""
    elev = coarse.astype(np.float32).astype(np.float64)
    ctx = V.Context(elev=elev, ppu=1, relief=True, sea_level=0.0,
                    constraints=constraints, manifest=manifest, geometry=geometry)
    results = V.run_checks(ctx, ["C2", "C6", "C9"])
    rows = [row for check in results.values() for row in check]
    bad = [row for row in rows if row.result != V.PASS]
    if bad:
        detail = "; ".join(f"{row.item} {row.result}: {row.detail}" for row in bad[:10])
        raise GateError("S3", f"validator: {detail}")
    return {row.item: [row.result, row.detail] for row in rows}
