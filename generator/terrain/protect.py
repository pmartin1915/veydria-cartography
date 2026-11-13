"""S1: protection sets (PHASE3-SPEC section S1).

Builds P_land and P_water at fine resolution from the manifest and the
constraints. Nothing later in the build may change the class of a protected
pixel. Route sampling reuses the validator's own helpers
(`validate._route_parts` / `validate._route_samples`): "the samples C3 keeps"
are exactly the samples C3 checks.

Precedence (spec S1): kept route samples first, then mouth reservations and
the caldera pool, then witnesses, then corridors, disks and rings. A lower
source is trimmed by a higher one: every pixel is claimed at most once, in
precedence order, and its first (highest) claimant fixes its class.

Every optional buffer or dilation of P_water is clipped to the Basin polygon
wherever its water joins the Basin outside the `mouth_cut` disk (spec S1, and
the section 7 tight spot "C8b allows no Basin water outside the Basin
polygon"). A kept sample pixel that itself lies there is a canon conflict:
Gate S1 stops and names it.

Gate S1: after trimming, P_land and P_water do not intersect.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Optional

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from . import validate as V
from .canon import (
    FRAME_H_U,
    FRAME_W_U,
    basin_polygon,
    canon_land_geometry,
    covers_xy,
    load_yaml,
    rasterize_mask,
    resolve_point,
)
from .params import f

CONN4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=int)  # as C8

# Precedence ranks (spec S1 "Precedence"); claimed in ascending order.
PRIO_KEPT_SAMPLE = 0
PRIO_MOUTH = 10
PRIO_WITNESS = 20
PRIO_CORRIDOR = 30
PRIO_DISK = 40
PRIO_RING = 50


class GateError(RuntimeError):
    """A build gate failed; `gate` names the stage (S1, S2a, S2, ...)."""

    def __init__(self, gate: str, message: str):
        self.gate = gate
        super().__init__(f"GATE {gate}: {message}")


@dataclass
class Protection:
    """The S1 result: protection sets plus the rasters S2 needs."""

    ppu: int
    p_land: np.ndarray
    p_water: np.ndarray
    canon_land: np.ndarray  # fine raster of the canon mask (spec A1)
    in_basin_poly: np.ndarray  # fine raster of the Basin polygon
    mouth_cut: np.ndarray  # fine raster of the mouth-cut disk (spec C8b)
    # P_water pixels claimed only by a sea route's optional corridor buffer
    # (never a kept sample). The delta-front class rule in S5 may release these.
    p_water_buffer: Optional[np.ndarray] = None

    @property
    def protected(self) -> np.ndarray:
        return self.p_land | self.p_water


@dataclass
class _Source:
    name: str
    prio: int
    seq: int
    pixels: np.ndarray  # bool raster of this source's footprint
    water: bool  # True: the source pins water (P_water); False: land (P_land)


def gate_s1_disjoint(p_land: np.ndarray, p_water: np.ndarray) -> None:
    """Gate S1: P_land and P_water must not intersect (spec S1)."""
    overlap = np.count_nonzero(p_land & p_water)
    if overlap:
        raise GateError(
            "S1",
            f"P_land and P_water intersect on {overlap} pixels: canon conflict")


def _disk_raster(grid_shape: tuple[int, int], ppu: int, x: float, y: float,
                 radius_u: float) -> np.ndarray:
    """Bool raster of the disk of `radius_u` around (x, y) (spec B sampling)."""
    rows, cols = grid_shape
    out = np.zeros(grid_shape, dtype=bool)
    c0 = max(0, int(np.floor((x - radius_u) * ppu)))
    c1 = min(cols, int(np.ceil((x + radius_u) * ppu)))
    r0 = max(0, int(np.floor((y - radius_u) * ppu)))
    r1 = min(rows, int(np.ceil((y + radius_u) * ppu)))
    if c1 <= c0 or r1 <= r0:
        return out
    xs = (np.arange(c0, c1) + 0.5) / ppu
    ys = (np.arange(r0, r1) + 0.5) / ppu
    d2 = (xs[None, :] - x) ** 2 + (ys[:, None] - y) ** 2
    out[r0:r1, c0:c1] = d2 <= radius_u * radius_u + 1e-12
    return out


def _corridor_raster(grid_shape: tuple[int, int], ppu: int,
                     samples: list[tuple[float, float]], half_width_u: float) -> np.ndarray:
    """Bool raster of the half-width corridor along sample points: every disk
    of `half_width_u` around every sample (spec S1 "corridor ... along the
    samples C3 keeps")."""
    out = np.zeros(grid_shape, dtype=bool)
    r_px = half_width_u * ppu
    rows, cols = grid_shape
    for x, y in samples:
        c0 = max(0, int(np.floor((x - half_width_u) * ppu)))
        c1 = min(cols, int(np.ceil((x + half_width_u) * ppu)))
        r0 = max(0, int(np.floor((y - half_width_u) * ppu)))
        r1 = min(rows, int(np.ceil((y + half_width_u) * ppu)))
        if c1 <= c0 or r1 <= r0:
            continue
        xs = (np.arange(c0, c1) + 0.5) / ppu
        ys = (np.arange(r0, r1) + 0.5) / ppu
        d2 = (xs[None, :] - x) ** 2 + (ys[:, None] - y) ** 2
        out[r0:r1, c0:c1] |= d2 <= half_width_u * half_width_u + 1e-12
    return out


def _polyline_samples_u(points, ppu: int) -> list[tuple[float, float]]:
    """Sample a polyline every 1/ppu units, reusing the validator's sampler."""
    return [(x, y) for _, x, y in V._polyline_samples(points, 1.0 / ppu)]


def _sample_pixel(grid_shape: tuple[int, int], ppu: int, x: float, y: float) -> Optional[tuple[int, int]]:
    """Pixel containing unit point (x, y) (spec B); None when outside the frame."""
    if not (0.0 <= x < FRAME_W_U and 0.0 <= y < FRAME_H_U):
        return None
    return int(y * ppu), int(x * ppu)


def _nearest_pixel_where(mask: np.ndarray, x: float, y: float, ppu: int,
                         max_window_u: float = 60.0) -> Optional[tuple[int, int]]:
    """Nearest pixel of `mask` to unit point (x, y), searched in a window."""
    rows, cols = mask.shape
    half = int(max_window_u * ppu)
    c = int(x * ppu)
    r = int(y * ppu)
    r0, r1 = max(0, r - half), min(rows, r + half + 1)
    c0, c1 = max(0, c - half), min(cols, c + half + 1)
    sub = mask[r0:r1, c0:c1]
    if not sub.any():
        return None
    ys, xs = np.nonzero(sub)
    d2 = (xs + c0 + 0.5 - x * ppu) ** 2 + (ys + r0 + 0.5 - y * ppu) ** 2
    idx = int(np.argmin(d2))
    return int(ys[idx] + r0), int(xs[idx] + c0)


def _witness(mask_side: np.ndarray, x: float, y: float, radius_u: float,
             bearing: tuple[float, float], clearance_tree: Optional[cKDTree],
             clearance_u: float, ppu: int) -> Optional[tuple[float, float]]:
    """Place one coast witness (spec S1 "Coast witnesses").

    The witness is the pixel of `mask_side` (canon land or canon water) inside
    the point's disk nearest the pin along `bearing` (dot product > 0). If it
    falls within `clearance_u` of a kept sample of the other class, it slides
    along the shore to the nearest in-disk candidate that clears them.
    """
    disk = _disk_raster(mask_side.shape, ppu, x, y, radius_u)
    candidates = np.nonzero(disk & mask_side)
    if candidates[0].size == 0:
        return None
    rr, cc = candidates
    px = (cc + 0.5) / ppu
    py = (rr + 0.5) / ppu
    to_pin = np.column_stack([px - x, py - y])
    aligned = to_pin[:, 0] * bearing[0] + to_pin[:, 1] * bearing[1] > 0.0
    if not aligned.any():
        aligned = np.ones(len(rr), dtype=bool)
    rr, cc, px, py = rr[aligned], cc[aligned], px[aligned], py[aligned]

    def clear(sel: np.ndarray) -> np.ndarray:
        if clearance_tree is None or clearance_tree.n == 0:
            return np.ones(len(sel), dtype=bool)
        dist, _ = clearance_tree.query(np.column_stack([px[sel] * ppu, py[sel] * ppu]))
        return dist >= clearance_u * ppu

    order = np.argsort((px - x) ** 2 + (py - y) ** 2, kind="stable")
    ok = clear(order)
    if ok.any():
        chosen = order[int(np.nonzero(ok)[0][0])]
    else:
        return None  # no placement clears the kept samples: the caller stops
    return float(px[chosen]), float(py[chosen])


def _clip_sea_water(owner: np.ndarray, is_water: np.ndarray,
                    kept_water_mask: np.ndarray, canon_land: np.ndarray,
                    in_basin_poly: np.ndarray, mouth_cut: np.ndarray) -> None:
    """Clip P_water buffers to the Basin polygon (spec S1 sea-route row).

    A P_water pixel outside the Basin polygon, outside the mouth-cut disk,
    4-connected to Basin water, is trimmed ("clipped"). A kept route sample
    that itself lands there is a canon conflict: Gate S1 stops and names it.
    """
    for _ in range(20):
        owned = owner >= 0
        # Water of the base mask: canon water, plus claimed water, minus
        # claimed land. Connectivity is measured with the mouth-cut disk
        # removed (as C8b measures it), so the open ocean — which joins the
        # Basin at Halkar — does not count as Basin-joined.
        water = (~canon_land & ~(owned & ~is_water)) | (owned & is_water)
        water &= ~mouth_cut
        labels, _ = ndimage.label(water, structure=CONN4)
        basin_water = water & in_basin_poly
        comps = np.unique(labels[basin_water])
        comps = comps[comps > 0]
        if comps.size == 0:
            break
        basin_joined = np.isin(labels, comps)
        leak = basin_joined & ~in_basin_poly & ~mouth_cut
        if not leak.any():
            break
        conflict = leak & kept_water_mask
        if conflict.any():
            rr, cc = np.nonzero(conflict)
            raise GateError(
                "S1",
                f"canon conflict: a kept sea-route sample lies outside the "
                f"Basin polygon (outside the mouth cut) with its water joined "
                f"to the Basin, e.g. pixel ({cc[0]},{rr[0]})")
        trimmable = leak & is_water & (owner >= 0) & ~kept_water_mask
        if not trimmable.any():
            raise GateError(
                "S1",
                "canon conflict: Basin-joined water outside the Basin polygon "
                "outside the mouth cut is not a trimmable P_water buffer")
        owner[trimmable] = -1
        is_water[trimmable] = False


def build_protection(manifest: dict, geometry: dict, constraints: dict,
                     params: dict, ppu: int) -> Protection:
    """Build P_land and P_water at `ppu` px/unit and run Gate S1."""
    grid_shape = (FRAME_H_U * ppu, FRAME_W_U * ppu)
    s1 = params["s1"]
    points = constraints.get("points", {})
    defaults = constraints.get("defaults", {})

    # Rasterised at the build's own resolution, exactly as the validator
    # rasterises them (spec C8): block-centre upsampling would disagree with
    # the validator's per-pixel polygon covers on boundary pixels.
    canon_land = rasterize_mask(canon_land_geometry(manifest, geometry), ppu)
    in_basin_poly = rasterize_mask(basin_polygon(manifest), ppu)
    cut = constraints.get("coast", {}).get("mouth_cut", {})
    cx, cy = resolve_point(manifest, cut.get("point"))
    mouth_cut = _disk_raster(grid_shape, ppu, cx, cy, float(cut.get("r_u", 15)))

    owner = np.full(grid_shape, -1, dtype=np.int32)
    is_water = np.zeros(grid_shape, dtype=bool)
    sources: list[_Source] = []

    def add(name: str, prio: int, pixels: np.ndarray, water: bool) -> None:
        sources.append(_Source(name, prio, len(sources), pixels, water))

    # -- the samples C3 keeps (validator's own sampling) ---------------------
    # Duck-typed context: _route_parts/_route_samples only read ppu, the frame
    # size and the manifest.
    ctx_like = SimpleNamespace(ppu=ppu, width_u=float(FRAME_W_U),
                               height_u=float(FRAME_H_U), manifest=manifest)
    tol = float(defaults.get("route_end_tol_u", 4))
    kept_land_pts: list[tuple[float, float]] = []
    kept_water_routes: list[tuple[str, list[tuple[float, float]]]] = []
    land_corridors: list[tuple[str, list[tuple[float, float]]]] = []
    for rid, entry in constraints.get("routes", {}).items():
        parts, err = V._route_parts(ctx_like, rid, entry)
        if err:
            raise GateError("S1", f"route {rid!r} does not resolve: {err}")
        for mode, poly, mode_change, stops in parts:
            kept, _ = V._route_samples(ctx_like, poly, tol, mode_change, stops)
            xy = [(x, y) for _, x, y in kept
                  if 0.0 <= x < FRAME_W_U and 0.0 <= y < FRAME_H_U]
            if mode == "sea":
                kept_water_routes.append((f"C3:{rid}({mode})", xy))
            else:
                kept_land_pts.extend(xy)
                land_corridors.append((f"corridor:{rid}({mode})", xy))
                # kept land samples themselves are protected at the highest rank
    kept_water_mask = np.zeros(grid_shape, dtype=bool)
    for name, xy in kept_water_routes:
        sample_mask = np.zeros(grid_shape, dtype=bool)
        for x, y in xy:
            pix = _sample_pixel(grid_shape, ppu, x, y)
            if pix is not None:
                sample_mask[pix] = True
        kept_water_mask |= sample_mask
        add(name, PRIO_KEPT_SAMPLE, sample_mask, water=True)
    kept_land_mask = np.zeros(grid_shape, dtype=bool)
    for x, y in kept_land_pts:
        pix = _sample_pixel(grid_shape, ppu, x, y)
        if pix is not None:
            kept_land_mask[pix] = True
    add("kept land/river route samples", PRIO_KEPT_SAMPLE, kept_land_mask, water=False)

    # kept-sample clearance trees for witness sliding (spec S1 coast witnesses)
    def tree_of(pts: list[tuple[float, float]]) -> Optional[cKDTree]:
        if not pts:
            return None
        arr = np.asarray(pts, dtype=np.float64) * ppu
        return cKDTree(arr)

    kept_land_tree = tree_of(kept_land_pts)
    kept_water_pts = [xy for _, xy in kept_water_routes]
    kept_water_flat = [p for xy in kept_water_pts for p in xy]
    kept_water_tree = tree_of(kept_water_flat)

    # -- mouth reservations, caldera pool and breach, Kelata channel ---------
    rivers = constraints.get("rivers", {})
    manifest_rivers = manifest.get("rivers", {})
    dist_mouths: list[tuple[float, float]] = []
    for rid, entry in rivers.items():
        if entry.get("kind") != "distributary":
            continue
        path = manifest_rivers.get(rid, {}).get("path")
        if path:
            dist_mouths.append((float(path[-1][0]), float(path[-1][1])))
    for n, (mx, my) in enumerate(dist_mouths):
        # Clipped to the Basin polygon (spec S1 table). A mouth the manifest
        # draws short of the Basin (distributaries 4 and 5) reserves nothing:
        # an unclipped disk there is a pond cut off inside the delta, which
        # the validator's pooling reads as ocean water in the floodplain.
        add(f"mouth reservation {n}", PRIO_MOUTH,
            _disk_raster(grid_shape, ppu, mx, my, f(params, "s1", "mouth_disk_u"))
            & in_basin_poly,
            water=True)

    caldera_pool = None
    for pid, entry in points.items():
        if entry.get("class") == "island" and entry.get("caldera"):
            caldera_pool = resolve_point(manifest, pid)
    if caldera_pool is not None:
        pool_r = f(params, "s1", "caldera_pool_radius_u")
        px, py = caldera_pool
        add("caldera pool", PRIO_MOUTH,
            _disk_raster(grid_shape, ppu, px, py, pool_r), water=True)
        coast_pix = _nearest_pixel_where(~canon_land, px, py, ppu)
        if coast_pix is not None:
            cy_, cx_ = coast_pix
            coast_x, coast_y = (cx_ + 0.5) / ppu, (cy_ + 0.5) / ppu
            direction = np.hypot(coast_x - px, coast_y - py)
            if direction > pool_r:
                ux, uy = (coast_x - px) / direction, (coast_y - py) / direction
                start = (px + ux * pool_r, py + uy * pool_r)
                breach_half = f(params, "s1", "caldera_breach_width_u") / 2.0
                samples = []
                length = float(np.hypot(coast_x - start[0], coast_y - start[1]))
                n_steps = max(2, int(np.ceil(length * ppu)))
                for k in range(n_steps + 1):
                    t = k / n_steps
                    samples.append((start[0] + t * (coast_x - start[0]),
                                    start[1] + t * (coast_y - start[1])))
                add("caldera breach", PRIO_MOUTH,
                    _corridor_raster(grid_shape, ppu, samples, breach_half),
                    water=True)

    for pid, entry in points.items():
        if entry.get("class") == "island" and entry.get("distinct_from"):
            other = entry["distinct_from"]
            try:
                ax, ay = resolve_point(manifest, pid)
                bx, by = resolve_point(manifest, other)
            except KeyError:
                continue
            gap = float(np.hypot(bx - ax, by - ay))
            islet_r = params["s1"].get("island_disk_overrides", {}).get(pid) \
                or f(params, "s1", "island_disk_u")
            shore_b = f(params, "s1", "island_disk_u")
            half = f(params, "s1", "kelata_channel_width_u") / 2.0
            ux, uy = (bx - ax) / gap, (by - ay) / gap
            start = (ax + ux * float(islet_r), ay + uy * float(islet_r))
            end = (bx - ux * (shore_b + half), by - uy * (shore_b + half))
            length = float(np.hypot(end[0] - start[0], end[1] - start[1]))
            if length > 0:
                samples = []
                n_steps = max(2, int(np.ceil(length * ppu)))
                for k in range(n_steps + 1):
                    t = k / n_steps
                    samples.append((start[0] + t * (end[0] - start[0]),
                                    start[1] + t * (end[1] - start[1])))
                add(f"kelata channel {pid}", PRIO_MOUTH,
                    _corridor_raster(grid_shape, ppu, samples, half), water=True)

    # -- coast witnesses ------------------------------------------------------
    witness_r = f(params, "s1", "witness_radius_u")
    clearance = f(params, "s1", "witness_clearance_u")
    for pid, entry in points.items():
        if entry.get("class") != "coast":
            continue
        x, y = resolve_point(manifest, pid)
        radius = float(entry.get("radius_u", defaults.get("point_radius_u", 3)))
        faces = entry.get("faces")
        bearing = V.COMPASS.get(faces, (0.0, 0.0))
        water_witness = _witness(~canon_land, x, y, radius, bearing,
                                 kept_land_tree, clearance, ppu)
        land_witness = _witness(canon_land, x, y, radius,
                                (-bearing[0], -bearing[1]),
                                kept_water_tree, clearance, ppu)
        for name, centre, water in (("water witness", water_witness, True),
                                    ("land witness", land_witness, False)):
            if centre is None:
                raise GateError(
                    "S1", f"coast point {pid!r}: no canon "
                          f"{'water' if water else 'land'} pixel in its disk "
                          f"that clears the kept route samples")
            add(f"{name} {pid}", PRIO_WITNESS,
                _disk_raster(grid_shape, ppu, centre[0], centre[1], witness_r),
                water=water)

    # -- corridors ------------------------------------------------------------
    river_half = f(params, "s1", "river_corridor_half_width_u")
    for rid, entry in rivers.items():
        path = manifest_rivers.get(rid, {}).get("path")
        if not path:
            continue
        pts = [(float(a), float(b)) for a, b in path]
        samples = _polyline_samples_u(pts, ppu)
        corridor = _corridor_raster(grid_shape, ppu, samples, river_half)
        if entry.get("kind") == "distributary":
            # The mouth vertex lies in canon water, so the full corridor would
            # pin land out in the Basin beyond the 1 u mouth reservation.
            # Near the mouth the corridor is clipped to canon land: the delta
            # front is the base mask (spec S1 rivers row, S2.4 delta front).
            mx, my = pts[-1]
            near_mouth = _disk_raster(grid_shape, ppu, mx, my, river_half + 1.0)
            corridor &= ~(near_mouth & ~canon_land)
        add(f"river corridor {rid}", PRIO_CORRIDOR, corridor, water=False)

    route_half = f(params, "s1", "route_corridor_half_width_u")
    for rid, entry in constraints.get("routes", {}).items():
        parts, err = V._route_parts(ctx_like, rid, entry)
        if err:
            raise GateError("S1", f"route {rid!r} does not resolve: {err}")
        for mode, poly, mode_change, stops in parts:
            if mode == "sea":
                kept, _ = V._route_samples(ctx_like, poly, tol, mode_change, stops)
                xy = [(x, y) for _, x, y in kept
                      if 0.0 <= x < FRAME_W_U and 0.0 <= y < FRAME_H_U]
                add(f"sea corridor {rid}", PRIO_CORRIDOR,
                    _corridor_raster(grid_shape, ppu, xy, route_half), water=True)
            else:
                # land/river corridors were collected with the kept samples
                pass
    for name, xy in land_corridors:
        add(name, PRIO_CORRIDOR,
            _corridor_raster(grid_shape, ppu, xy, route_half), water=False)

    # -- disks and rings ------------------------------------------------------
    for pid, entry in points.items():
        cls = entry.get("class")
        radius = float(entry.get("radius_u", defaults.get("point_radius_u", 3)))
        x, y = resolve_point(manifest, pid)
        if cls == "inland":
            add(f"inland disk {pid}", PRIO_DISK,
                _disk_raster(grid_shape, ppu, x, y, radius + f(params, "s1", "inland_extra_u")),
                water=False)
        elif cls == "land":
            add(f"land disk {pid}", PRIO_DISK,
                _disk_raster(grid_shape, ppu, x, y, radius), water=False)
        elif cls == "island":
            if entry.get("caldera"):
                ring_out = _disk_raster(grid_shape, ppu, x, y,
                                        f(params, "s1", "caldera_ring_outer_u"))
                ring_in = _disk_raster(grid_shape, ppu, x, y,
                                       f(params, "s1", "caldera_ring_inner_u"))
                add(f"caldera ring {pid}", PRIO_RING, ring_out & ~ring_in, water=False)
            else:
                override = params["s1"].get("island_disk_overrides", {}).get(pid)
                r = float(override) if override else f(params, "s1", "island_disk_u")
                add(f"island disk {pid}", PRIO_DISK,
                    _disk_raster(grid_shape, ppu, x, y, r), water=False)
        elif cls == "strait":
            add(f"strait disk {pid}", PRIO_DISK,
                _disk_raster(grid_shape, ppu, x, y, f(params, "s1", "strait_disk_u")),
                water=True)
        elif cls == "shoal":
            r_out = _disk_raster(grid_shape, ppu, x, y, radius + f(params, "s1", "shoal_ring_outset_u"))
            r_in = _disk_raster(grid_shape, ppu, x, y, max(radius - f(params, "s1", "shoal_ring_inset_u"), 0.0))
            add(f"shoal ring {pid}", PRIO_RING, r_out & ~r_in, water=True)

    try:
        neck = resolve_point(manifest, "the_neck")
    except KeyError:
        neck = None
    if neck is not None:
        add("the_neck disk", PRIO_DISK,
            _disk_raster(grid_shape, ppu, neck[0], neck[1],
                         f(params, "s1", "neck_disk_u")), water=False)

    # -- claim in precedence order --------------------------------------------
    sources.sort(key=lambda s: (s.prio, s.seq))
    for src in sources:
        free = src.pixels & (owner < 0)
        if not free.any():
            continue
        owner[free] = src.seq
        is_water[free] = bool(getattr(src, "water"))

    # -- clip P_water buffers to the Basin polygon (spec S1) ------------------
    _clip_sea_water(owner, is_water, kept_water_mask, canon_land,
                    in_basin_poly, mouth_cut)
    p_land = (owner >= 0) & ~is_water
    p_water = (owner >= 0) & is_water
    buffer_seqs = [src.seq for src in sources if src.name.startswith("sea corridor ")]
    p_water_buffer = p_water & np.isin(owner, buffer_seqs)

    gate_s1_disjoint(p_land, p_water)
    return Protection(ppu=ppu, p_land=p_land, p_water=p_water,
                      canon_land=canon_land, in_basin_poly=in_basin_poly,
                      mouth_cut=mouth_cut, p_water_buffer=p_water_buffer)
