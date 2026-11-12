"""Phase 2 terrain validator: bundle preflight (spec B) and checks C1-C6, C8, C9 (spec C).

CLI (spec C):
    python -m generator.terrain.validate <bundle> [--constraints path]
        [--checks C1,C3] [--json out.json] [--md out.md]

Exits 1 on any FAIL, 0 when nothing fails, 2 on bundle preflight rejection.
Every SKIP carries a reason; no check passes silently on empty input.
"""

from __future__ import annotations

import argparse
import heapq
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Union

import numpy as np
import yaml
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon

from .canon import (
    FRAME_H_U,
    FRAME_W_U,
    REPO_ROOT,
    covers_xy,
    canon_land_geometry,
    erode_and_clip,
    load_yaml,
    rasterize_mask,
    rect_mask,
    resolve_point,
    resolve_route_parts,
    resolve_shape,
)

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"

# Compass vectors, y down (spec C1 coast): N is -y.
COMPASS = {
    "N": (0.0, -1.0), "NE": (1.0, -1.0), "E": (1.0, 0.0), "SE": (1.0, 1.0),
    "S": (0.0, 1.0), "SW": (-1.0, 1.0), "W": (-1.0, 0.0), "NW": (-1.0, -1.0),
}
COS_67_5 = 0.3826834323650898  # cos(67.5 deg)

CONN8 = np.ones((3, 3), dtype=int)  # 8-connectivity (spec C1 island)
CONN4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=int)  # 4-connectivity (spec C8)

# D8 neighbour offsets; diagonals last so 4-neighbours win exact ties before
# the flood-order tie-break is applied.
D8_OFFSETS = [
    (-1, 0), (0, -1), (0, 1), (1, 0),
    (-1, -1), (-1, 1), (1, -1), (1, 1),
]

DOWN_EDGE = -1   # flows out of the frame (spec C4: trace to water or frame edge)
DOWN_WATER = -2  # water cell: trace terminal


class PreflightError(ValueError):
    """Bundle rejected before any check runs (spec B preflight)."""


@dataclass
class Row:
    """One line of a per-check report table (spec C: item, result, detail)."""

    item: str
    result: str  # PASS | FAIL | SKIP
    detail: str


@dataclass
class Bundle:
    """A terrain bundle (spec B): terrain.json metadata plus elevation.npy."""

    path: Path
    meta: dict
    elevation: np.ndarray
    relief: bool
    sea_level: float

    @property
    def ppu(self) -> int:
        return int(self.meta["px_per_unit"])


def load_bundle(path: Union[str, Path], strict_frame: bool = True) -> Bundle:
    """Load a bundle and apply the spec B preflight rules.

    Rejects (PreflightError) when ppu is not a positive integer, when the
    array shape is wrong for the frame and ppu, or when any value is non-finite.
    """
    bundle_dir = Path(path)
    meta_file = bundle_dir / "terrain.json"
    if not meta_file.is_file():
        raise PreflightError(f"missing terrain.json in {bundle_dir}")
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    ppu = meta.get("px_per_unit")
    if isinstance(ppu, bool) or not isinstance(ppu, int) or ppu <= 0:
        raise PreflightError(f"px_per_unit must be a positive integer, got {ppu!r}")
    width_u = meta.get("width_u", FRAME_W_U)
    height_u = meta.get("height_u", FRAME_H_U)
    if strict_frame and (width_u, height_u) != (FRAME_W_U, FRAME_H_U):
        # spec B: the frame is the schematic viewBox; a bundle may not redefine it.
        # strict_frame=False exists only for small synthetic test fixtures.
        raise PreflightError(f"frame {width_u}x{height_u} != the contract's {FRAME_W_U}x{FRAME_H_U}")
    elev_file = bundle_dir / meta.get("elevation", "elevation.npy")
    if not elev_file.is_file():
        raise PreflightError(f"missing elevation file {elev_file}")
    elevation = np.load(elev_file)
    expected = (int(height_u) * ppu, int(width_u) * ppu)
    if elevation.shape != expected:
        raise PreflightError(
            f"elevation shape {elevation.shape} != expected {expected} for "
            f"frame {width_u}x{height_u} at ppu {ppu}"
        )
    if not np.issubdtype(elevation.dtype, np.floating):
        elevation = elevation.astype(np.float64)
    if not np.isfinite(elevation).all():
        raise PreflightError("elevation contains non-finite values")
    return Bundle(
        path=bundle_dir,
        meta=meta,
        elevation=elevation,
        relief=bool(meta.get("relief", True)),
        sea_level=float(meta.get("sea_level_m", 0)),
    )


@dataclass
class Context:
    """Everything a check needs: the bundle raster plus already-loaded dicts.

    Check functions take a Context so tests can pass small synthetic arrays
    and dicts without any file I/O (spec D).
    """

    elev: np.ndarray
    ppu: int
    relief: bool
    sea_level: float
    constraints: dict
    manifest: dict
    geometry: dict
    bundle_path: str = "<memory>"
    _cache: dict = field(default_factory=dict, repr=False)

    @property
    def rows(self) -> int:
        return self.elev.shape[0]

    @property
    def cols(self) -> int:
        return self.elev.shape[1]

    @property
    def width_u(self) -> float:
        return self.cols / self.ppu

    @property
    def height_u(self) -> float:
        return self.rows / self.ppu

    @property
    def defaults(self) -> dict:
        return self.constraints.get("defaults", {})

    @property
    def km_per_unit(self) -> float:
        return float(self.constraints.get("meta", {}).get("km_per_unit", 4))

    def cached(self, key: str, fn: Callable):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    # -- derived rasters ----------------------------------------------------

    @property
    def water(self) -> np.ndarray:
        """Native-resolution water mask (spec B: water is elevation < sea level)."""
        return self.cached("water", lambda: self.elev < self.sea_level)

    @property
    def basin_geom(self):
        """Shapely aethelian_basin polygon, or None when the manifest lacks it."""
        def _load():
            poly = self.manifest.get("water", {}).get("aethelian_basin", {}).get("polygon")
            if not poly:
                return None
            return Polygon([(float(x), float(y)) for x, y in poly])
        return self.cached("basin_geom", _load)

    def basin_cover(self, rr: np.ndarray, cc: np.ndarray) -> Optional[np.ndarray]:
        """Boolean array: pixel centres (rr, cc) inside the Basin polygon."""
        geom = self.basin_geom
        if geom is None:
            return None
        xx = (cc + 0.5) / self.ppu
        yy = (rr + 0.5) / self.ppu
        return np.asarray(covers_xy(geom, xx, yy), dtype=bool)

    def basin_cover_point(self, x: float, y: float) -> Optional[bool]:
        geom = self.basin_geom
        if geom is None:
            return None
        return bool(geom.covers(Point(x, y)))

    @property
    def land_components(self):
        """8-connected land components: (labels, sizes, largest_label) (spec C1 island)."""
        def _label():
            labels, n = ndimage.label(~self.water, structure=CONN8)
            if n == 0:
                return labels, np.zeros(0, dtype=np.int64), -1
            sizes = np.bincount(labels.ravel())
            sizes[0] = 0
            largest = int(np.argmax(sizes))
            return labels, sizes, largest
        return self.cached("land_components", _label)

    @property
    def water_components4(self):
        """4-connected water components: (labels, sizes) (spec C8)."""
        def _label():
            return ndimage.label(self.water, structure=CONN4)
        return self.cached("water_components4", _label)

    @property
    def coarse(self) -> tuple[np.ndarray, np.ndarray]:
        """Coarse 1 px/unit grid per spec B: block means; a coarse cell is water
        when at least half its fine pixels are water; signs never disagree
        (land >= 0.1, water <= -0.1)."""
        def _pool():
            ppu = self.ppu
            h, w = self.rows // ppu, self.cols // ppu
            if self.rows % ppu or self.cols % ppu:
                raise ValueError("elevation shape not divisible by ppu")
            if ppu == 1:
                fine = self.elev
            else:
                fine = self.elev.reshape(h, ppu, w, ppu)
            mean = fine.mean(axis=(1, 3)) if ppu > 1 else self.elev.astype(np.float64)
            if ppu == 1:
                water = self.elev < self.sea_level
                mean = np.where(water, np.minimum(mean, -0.1), np.maximum(mean, 0.1))
                return mean, water
            water_frac = (fine < self.sea_level).mean(axis=(1, 3))
            water = water_frac >= 0.5
            mean = np.where(water, np.minimum(mean, -0.1), np.maximum(mean, 0.1))
            return mean, water
        return self.cached("coarse", _pool)

    @property
    def flood(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Priority-flood fill (spec C4): (filled, order, fill_depth).

        Water pixels are the outlets; ``order`` is the pop order (outlets
        first), used to break D8 ties on flats toward the outlet.
        """
        return self.cached("flood", lambda: _priority_flood(*self.coarse))

    @property
    def down(self) -> np.ndarray:
        """D8 downstream cell index per coarse cell (spec C4)."""
        def _compute():
            filled, order, _depth = self.flood
            _elev_c, water_c = self.coarse
            return _d8_downstream(filled, order, water_c)
        return self.cached("down", _compute)

    @property
    def acc(self) -> np.ndarray:
        """Accumulated upstream area per coarse cell, in km^2 (spec C4)."""
        return self.cached("acc", self._accumulate)

    def _accumulate(self) -> np.ndarray:
        filled, order, _ = self.flood
        down = self.down
        cell_km2 = self.km_per_unit ** 2
        acc = np.full(filled.shape, cell_km2, dtype=np.float64)
        order_flat = order.ravel()
        down_list = down.ravel().tolist()
        acc_flat = acc.ravel()
        # Reverse flood order: downstream cells are always processed after
        # their upstream neighbours, so one sequential pass is a valid
        # topological accumulation.
        for idx in np.argsort(order_flat)[::-1]:
            target = down_list[idx]
            if target >= 0:
                acc_flat[target] += acc_flat[idx]
        return acc

    # -- sampling helpers (spec B) -------------------------------------------

    def point_pixel(self, x: float, y: float) -> Optional[tuple[int, int]]:
        """Pixel containing unit point (x, y), or None when outside the frame."""
        if not (0.0 <= x < self.width_u and 0.0 <= y < self.height_u):
            return None
        return int(y * self.ppu), int(x * self.ppu)

    def disk(self, x: float, y: float, radius_u: float) -> Optional[tuple[np.ndarray, np.ndarray]]:
        """Pixel indices whose centres lie within radius_u of (x, y) (spec B)."""
        ppu = self.ppu
        c0 = max(0, int(np.floor((x - radius_u) * ppu)))
        c1 = min(self.cols, int(np.ceil((x + radius_u) * ppu)))
        r0 = max(0, int(np.floor((y - radius_u) * ppu)))
        r1 = min(self.rows, int(np.ceil((y + radius_u) * ppu)))
        if c1 <= c0 or r1 <= r0:
            return None
        xs = (np.arange(c0, c1) + 0.5) / ppu
        ys = (np.arange(r0, r1) + 0.5) / ppu
        xx, yy = np.meshgrid(xs, ys)
        mask = (xx - x) ** 2 + (yy - y) ** 2 <= radius_u * radius_u + 1e-12
        if not mask.any():
            return None
        rr, cc = np.nonzero(mask)
        return rr + r0, cc + c0

    def ring(self, x: float, y: float, radius_u: float, half_width: float = 0.5):
        """Pixel indices whose centres lie in [radius_u - half_width,
        radius_u + half_width] of (x, y); None when the ring is out of frame."""
        ppu = self.ppu
        reach = radius_u + half_width
        c0 = max(0, int(np.floor((x - reach) * ppu)))
        c1 = min(self.cols, int(np.ceil((x + reach) * ppu)))
        r0 = max(0, int(np.floor((y - reach) * ppu)))
        r1 = min(self.rows, int(np.ceil((y + reach) * ppu)))
        if c1 <= c0 or r1 <= r0:
            return None
        xs = (np.arange(c0, c1) + 0.5) / ppu
        ys = (np.arange(r0, r1) + 0.5) / ppu
        xx, yy = np.meshgrid(xs, ys)
        d2 = (xx - x) ** 2 + (yy - y) ** 2
        lo = max(radius_u - half_width, 0.0)
        mask = (d2 <= (radius_u + half_width) ** 2 + 1e-12) & (d2 >= lo * lo - 1e-12)
        if not mask.any():
            return None
        rr, cc = np.nonzero(mask)
        return rr + r0, cc + c0


# ---------------------------------------------------------------------------
# Flow machinery (spec C4): priority flood, D8, trace.
# ---------------------------------------------------------------------------

# shortcut: pure-Python heapq flood + per-cell C5(a) traces, ~2 min on the full frame;
# move to numba or a vectorised flood if Phase 3 runs the validator in a tight loop.
def _priority_flood(elev: np.ndarray, water: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Priority-flood depression filling with water pixels as outlets (spec C4)."""
    filled = elev.astype(np.float64).copy()
    order = np.full(elev.shape, -1, dtype=np.int64)
    visited = water.copy()
    rows, cols = elev.shape
    heap = []
    push, pop = heapq.heappush, heapq.heappop
    for r, c in np.argwhere(water):
        push(heap, (filled[r, c], int(r), int(c)))
    heapq.heapify(heap)
    seq = 0
    while heap:
        val, r, c = pop(heap)
        if order[r, c] >= 0:
            continue
        order[r, c] = seq
        seq += 1
        for dr, dc in D8_OFFSETS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc]:
                visited[nr, nc] = True
                fill_val = val if elev[nr, nc] < val else elev[nr, nc]
                filled[nr, nc] = fill_val
                push(heap, (fill_val, nr, nc))
    return filled, order, filled - elev


def _d8_downstream(filled: np.ndarray, order: np.ndarray, water: np.ndarray) -> np.ndarray:
    """D8 flow direction on the filled surface (spec C4).

    Each cell flows to its lowest neighbour; ties on flats go toward the
    outlet via the flood order (lower order = closer to the outlet). Water
    cells are terminals (DOWN_WATER); cells with no lower in-frame neighbour
    exit the frame (DOWN_EDGE).
    """
    rows, cols = filled.shape
    down = np.full((rows, cols), DOWN_EDGE, dtype=np.int64)
    best_val = np.full((rows, cols), np.inf)
    best_ord = np.full((rows, cols), np.iinfo(np.int64).max, dtype=np.int64)
    best_idx = np.full((rows, cols), -1, dtype=np.int64)
    rr_grid, cc_grid = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    for dr, dc in D8_OFFSETS:
        # shifted neighbour values with +inf padding outside the frame
        shifted_val = np.full((rows, cols), np.inf)
        shifted_ord = np.full((rows, cols), np.iinfo(np.int64).max, dtype=np.int64)
        r_src0, r_src1 = max(0, dr), min(rows, rows + dr)
        c_src0, c_src1 = max(0, dc), min(cols, cols + dc)
        r_dst0, r_dst1 = max(0, -dr), min(rows, rows - dr)
        c_dst0, c_dst1 = max(0, -dc), min(cols, cols - dc)
        shifted_val[r_dst0:r_dst1, c_dst0:c_dst1] = filled[r_src0:r_src1, c_src0:c_src1]
        shifted_ord[r_dst0:r_dst1, c_dst0:c_dst1] = order[r_src0:r_src1, c_src0:c_src1]
        nr = rr_grid + dr
        nc = cc_grid + dc
        n_idx = np.where((nr >= 0) & (nr < rows) & (nc >= 0) & (nc < cols), nr * cols + nc, -1)
        better = (shifted_val < best_val) | ((shifted_val == best_val) & (shifted_ord < best_ord))
        better &= n_idx >= 0
        best_val = np.where(better, shifted_val, best_val)
        best_ord = np.where(better, shifted_ord, best_ord)
        best_idx = np.where(better, n_idx, best_idx)
    # Strictly-lower neighbours win; on exact flats (same filled value, which
    # is how the flood leaves them) flow toward the neighbour the flood
    # reached first, i.e. closer to the outlet (spec C4).
    flow = (best_val < filled) | ((best_val == filled) & (best_ord < order))
    down[flow] = best_idx[flow]
    down[water] = DOWN_WATER
    return down


def _trace(start: int, down: np.ndarray, water: np.ndarray) -> tuple[list[int], str]:
    """Follow D8 downstream from a flat cell index (spec C4).

    Returns (path, terminal) where terminal is "water", "edge" or "cycle".
    """
    path: list[int] = []
    seen: set[int] = set()
    cell = start
    rows, cols = water.shape
    while True:
        if cell in seen:
            return path, "cycle"
        seen.add(cell)
        path.append(cell)
        r, c = divmod(cell, cols)
        if water[r, c]:
            return path, "water"
        nxt = down[r, c]
        if nxt < 0:
            return path, "edge"
        cell = nxt


def _nearest_land_cell(elev_c: np.ndarray, water_c: np.ndarray, x: float, y: float):
    """Snap a unit point to the nearest coarse land cell; None when none exist."""
    land_rr, land_cc = np.nonzero(~water_c)
    if land_rr.size == 0:
        return None
    tree = cKDTree(np.column_stack([land_cc + 0.5, land_rr + 0.5]))
    _, idx = tree.query([x, y])
    return int(land_rr[idx]) * elev_c.shape[1] + int(land_cc[idx])


def _polyline_samples(points, step: float) -> list[tuple[float, float, float]]:
    """Sample a polyline every `step` units of arc length.

    Returns [(arc_length, x, y), ...] starting at arc length 0.
    """
    pts = np.asarray(points, dtype=np.float64)
    seg = np.diff(pts, axis=0)
    seg_len = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0.0], np.cumsum(seg_len)])
    total = cum[-1]
    if total <= 0:
        return [(0.0, float(pts[0][0]), float(pts[0][1]))]
    samples = []
    seg_start = 0
    for t in np.arange(0.0, total + 1e-9, step):
        while seg_start < len(seg_len) - 1 and cum[seg_start + 1] < t - 1e-9:
            seg_start += 1
        seg_idx = min(seg_start, len(seg_len) - 1)
        denom = seg_len[seg_idx]
        frac = 0.0 if denom <= 0 else (t - cum[seg_idx]) / denom
        frac = min(max(frac, 0.0), 1.0)
        x = pts[seg_idx][0] + frac * seg[seg_idx][0]
        y = pts[seg_idx][1] + frac * seg[seg_idx][1]
        samples.append((float(t), float(x), float(y)))
    return samples


def _station_points(points, station_u: float, x_range, y_range) -> list[tuple[float, float, float]]:
    """Stations every station_u along a polyline, restricted to x/y ranges (spec C6)."""
    out = []
    for arc, x, y in _polyline_samples(points, station_u):
        if x_range is not None and not (x_range[0] <= x <= x_range[1]):
            continue
        if y_range is not None and not (y_range[0] <= y <= y_range[1]):
            continue
        out.append((arc, x, y))
    return out


# ---------------------------------------------------------------------------
# C1: point classes (spec C1) and C2: point elevation bands (spec C2).
# ---------------------------------------------------------------------------

def _result(ok: bool) -> str:
    return PASS if ok else FAIL


def check_c1(ctx: Context) -> list[Row]:
    """C1, point class, inside a disk of radius_u (default 3) (spec C1)."""
    points = ctx.constraints.get("points", {})
    if not points:
        return [Row("C1", SKIP, "no point entries in constraints")]
    rows = []
    water = ctx.water
    labels, sizes, largest = ctx.land_components
    ppu = ctx.ppu
    for pid, entry in points.items():
        item = f"C1:{pid}"
        cls = entry.get("class")
        try:
            x, y = resolve_point(ctx.manifest, pid)
        except KeyError as exc:
            rows.append(Row(item, SKIP, str(exc)))
            continue
        radius = float(entry.get("radius_u", ctx.defaults.get("point_radius_u", 3)))
        disk = ctx.disk(x, y, radius)
        if disk is None:
            rows.append(Row(item, SKIP, "disk entirely outside frame; no samples"))
            continue
        rr, cc = disk
        w = water[rr, cc]
        n_water = int(w.sum())
        n_pix = w.size

        if cls == "inland":
            rows.append(Row(item, _result(n_water == 0),
                            f"{n_water}/{n_pix} water pixels in disk"))
        elif cls == "land":
            frac = 1.0 - n_water / n_pix
            rows.append(Row(item, _result(frac > 0.5),
                            f"{frac:.2f} of disk is land (>0.5 required)"))
        elif cls == "coast":
            rows.append(_coast_row(ctx, item, entry, x, y, rr, cc, w))
        elif cls == "island":
            rows.append(_island_row(ctx, item, entry, x, y, rr, cc, w,
                                    labels, sizes, largest))
        elif cls == "strait":
            rows.append(_strait_row(ctx, item, entry, x, y))
        elif cls == "shoal":
            rows.append(_shoal_row(ctx, item, entry, x, y, rr, cc))
        else:
            rows.append(Row(item, SKIP, f"unknown point class {cls!r}"))
    return rows


def _coast_row(ctx, item, entry, x, y, rr, cc, w) -> Row:
    """C1 coast: mixed disk, stated water body, bearing within +-67.5 deg."""
    if not w.any() or w.all():
        return Row(item, FAIL, f"disk must hold land and water ({int(w.sum())}/{w.size} water)")
    body = entry.get("water")
    faces = entry.get("faces")
    if not faces or faces not in COMPASS:
        return Row(item, SKIP, f"coast entry needs faces: one of {sorted(COMPASS)}")
    basin_mask = ctx.basin_cover(rr, cc)
    if body == "basin" and basin_mask is None:
        return Row(item, SKIP, "manifest has no aethelian_basin polygon")
    if body == "basin":
        body_water = w & basin_mask
    elif body == "ocean":
        body_water = w if basin_mask is None else w & ~basin_mask
    else:
        return Row(item, SKIP, f"unknown water body {body!r}")
    frac = body_water.sum() / max(int(w.sum()), 1)
    if frac < 0.8:
        return Row(item, FAIL, f"only {frac:.2f} of disk water is {body} (>=0.8 required)")
    cx = (cc[body_water] + 0.5).mean() / ctx.ppu
    cy = (rr[body_water] + 0.5).mean() / ctx.ppu
    vx, vy = cx - x, cy - y
    norm = float(np.hypot(vx, vy))
    if norm <= 0:
        return Row(item, FAIL, "water centroid coincides with the point; no bearing")
    dx, dy = COMPASS[faces]
    cosang = (vx * dx + vy * dy) / (norm * float(np.hypot(dx, dy)))
    ok = cosang >= COS_67_5
    bearing = float(np.degrees(np.arctan2(vx, -vy)))  # 0 = N, clockwise
    return Row(item, _result(ok),
               f"{frac:.2f} of water is {body}; water centroid bearing "
               f"{bearing:.0f} deg vs faces {faces} (+/-67.5 deg)")


def _nearest_land_label(ctx, x, y, radius, labels):
    """Label of the land pixel nearest to (x, y) within a disk; None if no land."""
    disk = ctx.disk(x, y, radius)
    if disk is None:
        return None
    rr, cc = disk
    land = ~ctx.water[rr, cc]
    if not land.any():
        return None
    px = (cc[land] + 0.5) / ctx.ppu
    py = (rr[land] + 0.5) / ctx.ppu
    idx = int(np.argmin((px - x) ** 2 + (py - y) ** 2))
    return int(labels[rr[land][idx], cc[land][idx]])


def _island_row(ctx, item, entry, x, y, rr, cc, w, labels, sizes, largest) -> Row:
    """C1 island: small non-mainland component, optional distinct_from/caldera."""
    land = ~w
    if not land.any():
        return Row(item, FAIL, "no land pixel in disk")
    px = (cc[land] + 0.5) / ctx.ppu
    py = (rr[land] + 0.5) / ctx.ppu
    idx = int(np.argmin((px - x) ** 2 + (py - y) ** 2))
    label = int(labels[rr[land][idx], cc[land][idx]])
    max_area = float(entry.get("max_area_u2", 5000))
    area_limit = max_area * ctx.ppu ** 2
    reasons = []
    if label == largest:
        reasons.append("nearest land is the largest (mainland) component")
    if label >= 0 and sizes[label] > area_limit:
        reasons.append(f"component area {int(sizes[label])} px > {area_limit:.0f} px "
                       f"({max_area} u^2)")
    if entry.get("distinct_from"):
        other_id = entry["distinct_from"]
        try:
            ox, oy = resolve_point(ctx.manifest, other_id)
        except KeyError as exc:
            return Row(item, SKIP, str(exc))
        other_label = _nearest_land_label(ctx, ox, oy, 3.0, labels)
        if other_label is None:
            reasons.append(f"distinct_from point {other_id!r} has no land in its disk")
        elif other_label == label:
            reasons.append(f"same component as {other_id!r}")
    caldera_note = ""
    if entry.get("caldera"):
        radius_c = float(entry.get("radius_u", 4))
        disk_c = ctx.disk(x, y, radius_c)
        if disk_c is None:
            reasons.append("caldera disk outside frame")
        else:
            crr, ccc = disk_c
            cw = ctx.water[crr, ccc]
            found = False
            for wr, wc in zip(crr[cw], ccc[cw]):
                wx, wy = (wc + 0.5) / ctx.ppu, (wr + 0.5) / ctx.ppu
                ring = ctx.ring(wx, wy, 1.5, half_width=0.5)
                if ring is None:
                    continue
                qrr, qcc = ring
                ring_land_in_comp = (~ctx.water[qrr, qcc]) & (labels[qrr, qcc] == label)
                if ring_land_in_comp.sum() / qrr.size >= 0.7:
                    found = True
                    break
            if not found:
                reasons.append("no enclosed/near-enclosed water (caldera) in the island")
            else:
                caldera_note = "; caldera water enclosed"
    if reasons:
        return Row(item, FAIL, "; ".join(reasons))
    return Row(item, PASS, f"component {label} is not mainland and within area limit"
                            f"{caldera_note}")


def _strait_row(ctx, item, entry, x, y) -> Row:
    """C1 strait: water point, bounded water run along axis, joins Basin and ocean."""
    pix = ctx.point_pixel(x, y)
    if pix is None:
        return Row(item, SKIP, "point outside frame")
    r0, c0 = pix
    if not ctx.water[r0, c0]:
        return Row(item, FAIL, "point pixel is not water")
    axis = entry.get("axis")
    if axis not in ("NS", "EW"):
        return Row(item, SKIP, f"strait entry needs axis: NS|EW, got {axis!r}")
    rows_n, cols_n = ctx.water.shape
    water = ctx.water

    def walk(dr, dc):
        length = 0
        r, c = r0 + dr, c0 + dc
        while 0 <= r < rows_n and 0 <= c < cols_n and water[r, c]:
            length += 1
            r += dr
            c += dc
        bounded = 0 <= r < rows_n and 0 <= c < cols_n and not water[r, c]
        return length, bounded

    if axis == "NS":
        up, up_ok = walk(-1, 0)
        down, down_ok = walk(1, 0)
    else:
        up, up_ok = walk(0, -1)
        down, down_ok = walk(0, 1)
    if not (up_ok and down_ok):
        return Row(item, FAIL, f"water run along {axis} not bounded by land at both ends")
    length_u = (up + down + 1) / ctx.ppu
    min_u = float(entry.get("min_u", 0))
    max_u = float(entry.get("max_u", 1e9))
    if not (min_u <= length_u <= max_u):
        return Row(item, FAIL, f"water run length {length_u:.1f} u outside [{min_u}, {max_u}]")
    labels4, _ = ctx.water_components4
    comp = labels4[r0, c0]
    comp_pixels = labels4 == comp
    basin_mask = ctx.basin_cover(*np.nonzero(comp_pixels))
    if basin_mask is None:
        return Row(item, SKIP, "manifest has no aethelian_basin polygon")
    joins = basin_mask.any() and (~basin_mask).any()
    return Row(item, _result(bool(joins)),
               f"run {length_u:.1f} u within [{min_u}, {max_u}]; "
               f"joins basin and ocean through water: {bool(joins)}")


def _shoal_row(ctx, item, entry, x, y, rr, cc) -> Row:
    """C1 shoal: a disk pixel in the shoal band, ring mostly the stated water."""
    lo = float(entry.get("shoal_lo", -12))
    hi = float(entry.get("shoal_hi", 8))
    vals = ctx.elev[rr, cc]
    in_band = (vals >= lo) & (vals <= hi)
    if not in_band.any():
        return Row(item, FAIL, f"no disk pixel with elevation in [{lo}, {hi}] m")
    radius = float(entry.get("radius_u", ctx.defaults.get("point_radius_u", 3)))
    ring = ctx.ring(x, y, radius, half_width=0.5)
    if ring is None:
        return Row(item, SKIP, "ring outside frame; no samples")
    qrr, qcc = ring
    w = ctx.water[qrr, qcc]
    if not w.any():
        return Row(item, FAIL, "ring has no water at all")
    body = entry.get("water")
    basin_mask = ctx.basin_cover(qrr, qcc)
    if body == "basin" and basin_mask is None:
        return Row(item, SKIP, "manifest has no aethelian_basin polygon")
    body_water = w & basin_mask if body == "basin" else w if basin_mask is None else w & ~basin_mask
    frac = body_water.sum() / w.size  # of the whole ring, land included (spec C1 shoal)
    return Row(item, _result(frac >= 0.75),
               f"shoal band pixel present; {frac:.2f} of the ring is {body} water (>=0.75)")


def check_c2(ctx: Context) -> list[Row]:
    """C2, point elevation band: any pixel (default) or disk median in band (spec C2)."""
    if not ctx.relief:
        return [Row("C2", SKIP, "bundle declares relief: false (spec D)")]
    points = ctx.constraints.get("points", {})
    rows = []
    for pid, entry in points.items():
        band = entry.get("elevation_m")
        if not band:
            continue
        item = f"C2:{pid}"
        try:
            x, y = resolve_point(ctx.manifest, pid)
        except KeyError as exc:
            rows.append(Row(item, SKIP, str(exc)))
            continue
        radius = float(entry.get("radius_u", ctx.defaults.get("point_radius_u", 3)))
        disk = ctx.disk(x, y, radius)
        if disk is None:
            rows.append(Row(item, SKIP, "disk entirely outside frame; no samples"))
            continue
        vals = ctx.elev[disk]
        lo, hi = float(band[0]), float(band[1])
        if entry.get("sample", "any") == "median":
            stat = float(np.median(vals))
            ok = lo <= stat <= hi
            rows.append(Row(item, _result(ok),
                            f"disk median {stat:.1f} m in [{lo}, {hi}]: {ok}"))
        else:
            hit = ((vals >= lo) & (vals <= hi)).sum()
            ok = hit > 0
            rows.append(Row(item, _result(ok),
                            f"{hit}/{vals.size} disk pixels in [{lo}, {hi}] m"))
    if not rows:
        return [Row("C2", SKIP, "no point elevation bands declared in constraints")]
    return rows


# ---------------------------------------------------------------------------
# C3: routes (spec C3).
# ---------------------------------------------------------------------------

def check_c3(ctx: Context) -> list[Row]:
    """C3, routes: sample parts every 1/ppu units, drop ends/mode changes/stops."""
    routes = ctx.constraints.get("routes", {})
    if not routes:
        return [Row("C3", SKIP, "no route entries in constraints")]
    tol = float(ctx.defaults.get("route_end_tol_u", 4))
    rows = []
    for rid, entry in routes.items():
        parts, err = _route_parts(ctx, rid, entry)
        if err:
            rows.append(Row(f"C3:{rid}", SKIP, err))
            continue
        for i, (mode, poly, mode_change_vertices, stops) in enumerate(parts):
            item = f"C3:{rid}[{i}]({mode})"
            kept, n_out = _route_samples(ctx, poly, tol, mode_change_vertices, stops)
            if not kept:
                rows.append(Row(item, SKIP,
                                "no samples kept (all dropped or outside frame)"))
                continue
            bad = _route_violations(ctx, mode, kept)
            if not bad:
                detail = f"{len(kept)} samples, all on { _surface(mode) }"
                if n_out:
                    detail += f"; {n_out} samples outside frame skipped"
                rows.append(Row(item, PASS, detail))
            else:
                runs = "; ".join(
                    f"run {j + 1}: ({sx:.1f},{sy:.1f})->({ex:.1f},{ey:.1f}) len {ln:.1f} u"
                    for j, (sx, sy, ex, ey, ln) in enumerate(bad))
                rows.append(Row(item, FAIL,
                                f"{len(bad)} violating run(s) over {len(kept)} samples: {runs}"))
    return rows


def _surface(mode: str) -> str:
    return "water" if mode == "sea" else "land"


def _stop_id(stop) -> str:
    """A stop is a point ID or {id, r_u} (spec C3; r_u overrides route_end_tol_u)."""
    return stop["id"] if isinstance(stop, dict) else stop


def _route_parts(ctx, rid, entry):
    """Resolve a constraints route entry to [(mode, polyline, mode_change_vertices, stops)]."""
    try:
        mpaths = resolve_route_parts(ctx.manifest, rid)
    except KeyError as exc:
        return None, str(exc)
    route_stops = list(entry.get("stops", []))
    for sid in route_stops:
        try:
            resolve_point(ctx.manifest, _stop_id(sid))
        except KeyError as exc:
            return None, str(exc)
    if "mode" in entry:
        return [(entry["mode"], p, set(), route_stops) for p in mpaths], None
    if "parts" in entry:
        if len(entry["parts"]) != len(mpaths):
            return None, (f"constraints has {len(entry['parts'])} parts but the manifest "
                          f"route has {len(mpaths)}")
        out = []
        for part_entry, poly in zip(entry["parts"], mpaths):
            stops = route_stops + list(part_entry.get("stops", []))
            for sid in part_entry.get("stops", []):
                try:
                    resolve_point(ctx.manifest, _stop_id(sid))
                except KeyError as exc:
                    return None, str(exc)
            out.append((part_entry["mode"], poly, set(), stops))
        return out, None
    if "modes" in entry:
        if len(mpaths) != 1:
            return None, "modes: ranges apply to a single manifest path"
        path = mpaths[0]
        n = len(path)
        out = []
        for m in entry["modes"]:
            i, j = (int(v) for v in m["vertices"])
            if not (0 <= i < j < n):
                return None, f"modes: vertex range [{i}, {j}] out of bounds for {n} vertices"
            interior = {path[k] for k in (i, j) if 0 < k < n - 1}
            out.append((m["mode"], path[i:j + 1], interior, route_stops))
        return out, None
    return None, "route entry has neither mode, parts nor modes"


def _route_samples(ctx, poly, tol, mode_change_vertices, stops):
    """Sample a part polyline every 1/ppu units, dropping samples near ends,
    mode-change vertices and stops (spec C3). Returns (kept, n_out_of_frame)."""
    step = 1.0 / ctx.ppu
    raw = _polyline_samples(poly, step)
    drop_points = [(*poly[0], tol), (*poly[-1], tol)] + [(*v, tol) for v in mode_change_vertices]
    for stop in stops:
        r = float(stop.get("r_u", tol)) if isinstance(stop, dict) else tol
        drop_points.append((*resolve_point(ctx.manifest, _stop_id(stop)), r))
    kept = []
    n_out = 0
    for arc, x, y in raw:
        if any((x - dx) ** 2 + (y - dy) ** 2 <= r * r for dx, dy, r in drop_points):
            continue
        if not (0.0 <= x < ctx.width_u and 0.0 <= y < ctx.height_u):
            n_out += 1
            continue
        kept.append((arc, x, y))
    return kept, n_out


def _route_violations(ctx, mode, kept) -> list[tuple[float, float, float, float, float]]:
    """Group violating samples into runs: (start_x, start_y, end_x, end_y, length_u)."""
    step = 1.0 / ctx.ppu
    bad_runs = []
    run = []
    for arc, x, y in kept:
        r, c = int(y * ctx.ppu), int(x * ctx.ppu)
        is_water = bool(ctx.water[r, c])
        violating = is_water if mode in ("land", "river") else not is_water
        if violating:
            run.append((x, y))
        elif run:
            bad_runs.append(run)
            run = []
    if run:
        bad_runs.append(run)
    out = []
    for run in bad_runs:
        sx, sy = run[0]
        ex, ey = run[-1]
        out.append((sx, sy, ex, ey, max(len(run) * step, step)))
    return out


# ---------------------------------------------------------------------------
# C4: convergent rivers (spec C4). Coarse grid.
# ---------------------------------------------------------------------------

def check_c4(ctx: Context) -> list[Row]:
    """C4, convergent rivers: D8 trace from the snapped entry, line adherence,
    terminus, catchment areas and fill depth (spec C4)."""
    if not ctx.relief:
        return [Row("C4", SKIP, "bundle declares relief: false (spec D)")]
    rivers = {k: v for k, v in ctx.constraints.get("rivers", {}).items()
              if v.get("kind") == "convergent"}
    if not rivers:
        return [Row("C4", SKIP, "no convergent rivers declared in constraints")]
    elev_c, water_c = ctx.coarse
    filled, order, depth = ctx.flood
    down = ctx.down
    acc = ctx.acc
    cols_c = elev_c.shape[1]
    rows = []
    for rid, entry in rivers.items():
        item = f"C4:{rid}"
        river = ctx.manifest.get("rivers", {}).get(rid)
        if river is None or "path" not in river:
            rows.append(Row(item, SKIP, f"manifest river {rid!r} not found"))
            continue
        path = [(float(x), float(y)) for x, y in river["path"]]
        entry_x, entry_y = path[0]
        start = _nearest_land_cell(elev_c, water_c, entry_x, entry_y)
        if start is None:
            rows.append(Row(item, FAIL, "no coarse land cell to snap the entry to"))
            continue
        trace, terminal = _trace(start, down, water_c)
        failures = []

        # 1. every polyline sample beyond river_head_skip_u has a trace cell
        #    within river_tol_u
        tol = float(ctx.defaults.get("river_tol_u", 6))
        skip = float(ctx.defaults.get("river_head_skip_u", 8))
        samples = [(t, x, y) for t, x, y in _polyline_samples(path, 1.0) if t > skip]
        if samples:
            tree = cKDTree([((c % cols_c) + 0.5, (c // cols_c) + 0.5) for c in trace])
            dists = tree.query([(x, y) for _, x, y in samples])[0]
            n_off = int((dists > tol).sum())
            if n_off:
                worst = float(dists.max())
                failures.append(f"{n_off}/{len(samples)} samples beyond {skip} u have no "
                                f"trace cell within {tol} u (worst {worst:.1f} u)")
        else:
            failures.append(f"no polyline samples beyond river_head_skip_u {skip}")

        # 2. the trace passes through its terminus
        term = entry.get("terminus") or {}
        term_index = len(trace) - 1
        if "disk" in term:
            try:
                px, py = resolve_point(ctx.manifest, term["disk"])
            except KeyError as exc:
                rows.append(Row(item, SKIP, str(exc)))
                continue
            r_u = float(term.get("r_u", ctx.defaults.get("river_tol_u", 6)))
            hit = None
            for i, cell in enumerate(trace):
                cx, cy = (cell % cols_c) + 0.5, (cell // cols_c) + 0.5
                if (cx - px) ** 2 + (cy - py) ** 2 <= r_u * r_u:
                    hit = i
                    break
            if hit is None:
                failures.append(f"trace misses terminus disk {term['disk']!r} r={r_u}")
                term_index = len(trace) - 1
            else:
                term_index = hit
        elif "water" in term:
            near_id = term.get("near")
            try:
                nx, ny = resolve_point(ctx.manifest, near_id)
            except KeyError as exc:
                rows.append(Row(item, SKIP, str(exc)))
                continue
            r_u = float(term.get("r_u", 10))
            end_cell = trace[-1]
            er, ec = divmod(end_cell, cols_c)
            cx, cy = ec + 0.5, er + 0.5
            near_ok = (cx - nx) ** 2 + (cy - ny) ** 2 <= r_u * r_u
            if not water_c[er, ec]:
                failures.append(f"trace ends at {terminal}, not in water")
            elif term["water"] == "basin":
                in_basin = ctx.basin_cover_point(cx, cy)
                if in_basin is None:
                    rows.append(Row(item, SKIP, "manifest has no aethelian_basin polygon"))
                    continue
                if not in_basin:
                    failures.append("trace ends in water, but not Basin water")
            elif term["water"] == "ocean" and ctx.basin_cover_point(cx, cy):
                failures.append("trace ends in Basin water, not ocean")
            if not near_ok:
                failures.append(f"trace end ({cx:.1f},{cy:.1f}) not within r={r_u} of {near_id!r}")
        else:
            rows.append(Row(item, SKIP, "river entry has no terminus"))
            continue

        # 3./4. accumulated area at entry and at the terminus
        entry_min = entry.get("entry_min_area_km2")
        if entry_min is not None and acc.ravel()[start] < float(entry_min):
            failures.append(f"entry area {acc.ravel()[start]:.0f} km2 < "
                            f"entry_min_area_km2 {entry_min}")
        min_area = entry.get("min_area_km2")
        if min_area is not None and acc.ravel()[trace[term_index]] < float(min_area):
            failures.append(f"terminus area {acc.ravel()[trace[term_index]]:.0f} km2 < "
                            f"min_area_km2 {min_area}")

        # 5. fill depth along the trace up to the terminus
        max_fill = float(ctx.defaults.get("max_fill_m", 10))
        depth_flat = depth.ravel()
        worst_fill = max((depth_flat[c] for c in trace[:term_index + 1]), default=0.0)
        if worst_fill > max_fill:
            failures.append(f"fill depth {worst_fill:.1f} m > max_fill_m {max_fill} "
                            f"(river certified only by depression filling)")

        detail = "; ".join(failures) if failures else (
            f"trace {len(trace)} cells from entry ({entry_x:.0f},{entry_y:.0f}), "
            f"terminal {terminal}, fill depth {worst_fill:.1f} m")
        rows.append(Row(item, FAIL if failures else PASS, detail))
    return rows


# ---------------------------------------------------------------------------
# C5: Ndjadi outlet and distributaries (spec C5).
# ---------------------------------------------------------------------------

def check_c5(ctx: Context) -> list[Row]:
    """C5: (a) ndjadi core drainage, (b) distributary channels, (c) neck connection."""
    if not ctx.relief:
        return [Row("C5", SKIP, "bundle declares relief: false (spec D)")]
    rivers = ctx.constraints.get("rivers", {})
    params = ctx.constraints.get("ndjadi_outlet") or {}
    has_dist = any(v.get("kind") == "distributary" for v in rivers.values())
    if not params and not has_dist:
        return [Row("C5", SKIP, "no ndjadi_outlet params and no distributaries declared")]
    rows = []
    if params:
        rows.extend(_check_c5a(ctx, params))
        rows.append(_check_c5c(ctx, params))
    if has_dist:
        rows.extend(_check_c5b(ctx, rivers))
    return rows


def _core_mask(ctx, params) -> Optional[np.ndarray]:
    """Core of the floodplain polygon eroded by core_erode_u, on the coarse grid."""
    try:
        geom = resolve_shape(ctx.manifest, ctx.geometry, params["floodplain"])
    except KeyError as exc:
        return None
    eroded = erode_and_clip(geom, float(params.get("core_erode_u", 6)))
    _, water_c = ctx.coarse
    mask = rasterize_mask(eroded, 1, ctx.width_u, ctx.height_u)
    if mask.shape != water_c.shape:
        mask = mask[: water_c.shape[0], : water_c.shape[1]]
    return mask


def _check_c5a(ctx, params) -> list[Row]:
    """C5(a) drainage: every core trace ends in Basin water near the outlet;
    nothing south (no ocean); southern core pixels pass the neck."""
    item = "C5a"
    elev_c, water_c = ctx.coarse
    down = ctx.down
    try:
        outlet_x, outlet_y = resolve_point(ctx.manifest, params["outlet_near"])
        neck_x, neck_y = resolve_point(ctx.manifest, params["neck"])
    except KeyError as exc:
        return [Row(item, SKIP, str(exc))]
    core = _core_mask(ctx, params)
    if core is None:
        return [Row(item, SKIP, f"ndjadi_outlet floodplain shape "
                                 f"{params.get('floodplain')!r} does not resolve")]
    # spec C5a: trace EVERY core pixel by D8; water core cells terminate
    # immediately in water.
    core_rr, core_cc = np.nonzero(core)
    if core_rr.size == 0:
        return [Row(f"{item}:ocean", SKIP, "zero core cells after erosion; no samples"),
                Row(f"{item}:basin", SKIP, "zero core cells after erosion; no samples"),
                Row(f"{item}:neck", SKIP, "zero core cells after erosion; no samples")]
    outlet_r2 = float(params.get("outlet_r_u", 90)) ** 2
    neck_r2 = float(params.get("neck_r_u", 12)) ** 2
    cols_c = elev_c.shape[1]

    def cell_xy(cell):
        return (cell % cols_c) + 0.5, (cell // cols_c) + 0.5

    n_ocean = 0
    n_basin = 0
    n_south = 0
    n_south_neck = 0
    for r, c in zip(core_rr, core_cc):
        trace, _terminal = _trace(int(r) * cols_c + int(c), down, water_c)
        end = trace[-1]
        ex, ey = cell_xy(end)
        er, ec = divmod(end, cols_c)
        if (r + 0.5) > neck_y:  # counted before the terminal test (Sol review)
            n_south += 1
            if any((cx - neck_x) ** 2 + (cy - neck_y) ** 2 <= neck_r2
                   for cx, cy in (cell_xy(t) for t in trace)):
                n_south_neck += 1
        if not water_c[er, ec]:
            continue  # ended on land/cycle/edge: counted in neither water bucket
        in_basin = ctx.basin_cover_point(ex, ey)
        if in_basin is False:
            n_ocean += 1
        elif in_basin and (ex - outlet_x) ** 2 + (ey - outlet_y) ** 2 <= outlet_r2:
            n_basin += 1
    total = int(core_rr.size)
    rows = [
        Row(f"{item}:ocean", _result(n_ocean == 0),
            f"{n_ocean}/{total} core traces end in ocean water ('nothing south')"),
        Row(f"{item}:basin", _result(n_basin >= 0.99 * total),
            f"{n_basin}/{total} core traces end in Basin water within "
            f"outlet_r_u {float(params.get('outlet_r_u', 90)):.0f} of "
            f"{params['outlet_near']!r} (>=99%)"),
        Row(f"{item}:neck", SKIP if n_south == 0 else _result(n_south_neck >= 0.95 * n_south),
            f"{n_south_neck}/{n_south} southern core traces pass within neck_r_u "
            f"{float(params.get('neck_r_u', 12)):.0f} of {params['neck']!r} (>=95%)"),
    ]
    return rows


def _check_c5b(ctx, rivers) -> list[Row]:
    """C5(b) distributaries: apex height, total uphill, banks, mouth in Basin."""
    defaults = ctx.defaults
    max_uphill = float(defaults.get("max_uphill_m", 3))
    bank_u = float(defaults.get("bank_u", 2))
    rows = []
    for rid, entry in rivers.items():
        if entry.get("kind") != "distributary":
            continue
        item = f"C5b:{rid}"
        river = ctx.manifest.get("rivers", {}).get(rid)
        if river is None or "path" not in river:
            rows.append(Row(item, SKIP, f"manifest river {rid!r} not found"))
            continue
        path = [(float(x), float(y)) for x, y in river["path"]]
        samples = _polyline_samples(path, 1.0 / ctx.ppu)
        samples = [(t, x, y) for t, x, y in samples
                   if 0.0 <= x < ctx.width_u and 0.0 <= y < ctx.height_u]
        if not samples:
            rows.append(Row(item, SKIP, "no in-frame samples along the channel"))
            continue
        failures = []
        e = np.array([ctx.elev[int(y * ctx.ppu), int(x * ctx.ppu)]
                      for _, x, y in samples])
        if e[0] > 50.0:
            failures.append(f"apex elevation {e[0]:.1f} m > 50")
        # sum over samples of max(0, e[i] - min(e[0..i-1])) (spec C5b);
        # where e[i] is the running minimum the contribution is zero, so
        # np.minimum.accumulate (which includes e[i] itself) is equivalent.
        run_min = np.minimum.accumulate(e)
        uphill = float(np.sum(np.where(e > run_min, e - run_min, 0.0)))
        if uphill > max_uphill:
            failures.append(f"total uphill {uphill:.2f} m > max_uphill_m {max_uphill}")
        # banks
        pts = np.asarray([(x, y) for _, x, y in samples])
        tangents = np.gradient(pts, axis=0)
        norms = np.hypot(tangents[:, 0], tangents[:, 1])
        norms[norms == 0] = 1.0
        dirs = tangents / norms[:, None]
        perp = np.column_stack([-dirs[:, 1], dirs[:, 0]])
        below = 0
        n_bank = 0
        for i, (_, x, y) in enumerate(samples):
            row = int(y * ctx.ppu)
            col = int(x * ctx.ppu)
            for sign in (1.0, -1.0):
                bx = x + sign * bank_u * perp[i][0]
                by = y + sign * bank_u * perp[i][1]
                if not (0.0 <= bx < ctx.width_u and 0.0 <= by < ctx.height_u):
                    below -= 1  # missing bank counts against the sample
                    break
                be = ctx.elev[int(by * ctx.ppu), int(bx * ctx.ppu)]
                if e[i] > be - 0.5:
                    break
            else:
                below += 1
            n_bank += 1
        frac_below = below / max(n_bank, 1)
        if frac_below < 0.8:
            failures.append(f"{frac_below:.2f} of samples >=0.5 m below both banks "
                            f"(>=0.80 required)")
        # mouth in Basin water (mouth sample or one within 1 unit of it)
        mouth_x, mouth_y = path[-1]
        mouth_ok = False
        mouth_skip = False
        for t, x, y in reversed(samples):
            if (x - mouth_x) ** 2 + (y - mouth_y) ** 2 > 1.0:
                break
            r, c = int(y * ctx.ppu), int(x * ctx.ppu)
            if ctx.water[r, c]:
                in_basin = ctx.basin_cover_point((c + 0.5) / ctx.ppu, (r + 0.5) / ctx.ppu)
                if in_basin is None:
                    rows.append(Row(item, SKIP,
                                    "manifest has no aethelian_basin polygon"))
                    mouth_skip = True
                    break
                if in_basin:
                    mouth_ok = True
                    break
        if mouth_skip:
            continue
        if not mouth_ok:
            failures.append("mouth sample (or one within 1 u of it) is not Basin water")
        detail = "; ".join(failures) if failures else (
            f"apex {e[0]:.1f} m, uphill {uphill:.2f} m, banks {frac_below:.2f}, "
            f"mouth in Basin water")
        rows.append(Row(item, FAIL if failures else PASS, detail))
    if not rows:
        return [Row("C5b", SKIP, "no distributary rivers declared")]
    return rows


def _check_c5c(ctx, params) -> Row:
    """C5(c) connection: the neck's D8 trace ends in Basin water near the outlet,
    with fill depth within max_fill_m (spec C5c)."""
    item = "C5c"
    elev_c, water_c = ctx.coarse
    filled, order, depth = ctx.flood
    down = ctx.down
    try:
        neck_x, neck_y = resolve_point(ctx.manifest, params["neck"])
        outlet_x, outlet_y = resolve_point(ctx.manifest, params["outlet_near"])
    except KeyError as exc:
        return Row(item, SKIP, str(exc))
    # spec C5c: the coarse cell that CONTAINS the neck, never a snapped neighbour
    nr, nc = int(np.floor(neck_y)), int(np.floor(neck_x))
    if not (0 <= nr < elev_c.shape[0] and 0 <= nc < elev_c.shape[1]):
        return Row(item, SKIP, "neck point outside the frame")
    if water_c[nr, nc]:
        return Row(item, FAIL, "the coarse cell containing the neck is water")
    start = nr * elev_c.shape[1] + nc
    trace, terminal = _trace(start, down, water_c)
    cols_c = elev_c.shape[1]
    end = trace[-1]
    er, ec = divmod(end, cols_c)
    ex, ey = ec + 0.5, er + 0.5
    outlet_r2 = float(params.get("outlet_r_u", 90)) ** 2
    failures = []
    if not water_c[er, ec]:
        failures.append(f"trace ends at {terminal}, not in water")
    else:
        in_basin = ctx.basin_cover_point(ex, ey)
        if in_basin is None:
            return Row(item, SKIP, "manifest has no aethelian_basin polygon")
        if not in_basin:
            failures.append("trace ends in water, but not Basin water")
        elif (ex - outlet_x) ** 2 + (ey - outlet_y) ** 2 > outlet_r2:
            failures.append(f"trace end not within outlet_r_u of {params['outlet_near']!r}")
    max_fill = float(ctx.defaults.get("max_fill_m", 10))
    depth_flat = depth.ravel()
    worst_fill = max((depth_flat[c] for c in trace), default=0.0)
    if worst_fill > max_fill:
        failures.append(f"fill depth {worst_fill:.1f} m > max_fill_m {max_fill}")
    detail = "; ".join(failures) if failures else (
        f"neck trace ({len(trace)} cells) ends in Basin water within outlet_r_u; "
        f"fill depth {worst_fill:.1f} m")
    return Row(item, FAIL if failures else PASS, detail)


# ---------------------------------------------------------------------------
# C6: hard-line profiles (spec C6). Native resolution.
# ---------------------------------------------------------------------------

def check_c6(ctx: Context) -> list[Row]:
    """C6: stations along geometry lines; side/on_line/water_within tests."""
    lines = ctx.constraints.get("lines", {})
    if not lines:
        return [Row("C6", SKIP, "no lines entries in constraints")]
    rows = []
    for name, entry in lines.items():
        geom_key = entry.get("geometry")
        poly = ctx.geometry.get("lines", {}).get(geom_key)
        if poly is None:
            rows.append(Row(f"C6:{name}", SKIP,
                            f"terrain-geometry lines key {geom_key!r} not found"))
            continue
        points = [(float(x), float(y)) for x, y in poly]
        station_u = float(entry.get("station_u", 10))
        stations = _station_points(points, station_u, entry.get("x_range"), entry.get("y_range"))
        if not stations:
            rows.append(Row(f"C6:{name}", SKIP,
                            f"no stations along {geom_key!r} within the given ranges"))
            continue
        min_frac = float(entry.get("min_frac", 0.8))
        results = []  # (Row, per-station oks or None when the test SKIPs)
        for side in entry.get("sides", []):
            results.append(_c6_side(ctx, name, points, stations, side, min_frac))
        if "on_line" in entry:
            results.append(_c6_on_line(ctx, name, points, stations, entry["on_line"], min_frac))
        if "water_within_u" in entry:
            results.append(_c6_water_within(ctx, name, points, stations,
                                             entry["water_within_u"], min_frac))
        if not results:
            rows.append(Row(f"C6:{name}", SKIP, "no tests configured for this line"))
            continue
        rows.extend(r for r, _ in results)
        # spec C6: the tests must hold TOGETHER at >= min_frac of stations (Sol review)
        live = [oks for _, oks in results if oks is not None]
        if len(live) > 1:
            joint = sum(all(t[i] for t in live) for i in range(len(stations)))
            frac = joint / len(stations)
            rows.append(Row(f"C6:{name}:joint", _result(frac >= min_frac),
                            f"{joint}/{len(stations)} stations pass all {len(live)} tests "
                            f"together ({frac:.2f} >= {min_frac})"))
    return rows


def _tangent_at(points, arc):
    """Direction of the polyline segment containing arc length `arc`."""
    acc = 0.0
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        seg = float(np.hypot(x1 - x0, y1 - y0))
        if seg > 0 and arc <= acc + seg + 1e-9:
            return x1 - x0, y1 - y0
        acc += seg
    (x0, y0), (x1, y1) = points[-2], points[-1]
    return x1 - x0, y1 - y0


def _side_direction(points, stations, idx, toward):
    """Unit perpendicular at a station whose dot product with the compass
    vector is positive (spec C6 Sides). The tangent comes from the original
    polyline, so a single station still has a real perpendicular (Sol review)."""
    arc, x, y = stations[idx]
    tx, ty = _tangent_at(points, arc)
    norm = float(np.hypot(tx, ty)) or 1.0
    px, py = -ty / norm, tx / norm
    dx, dy = COMPASS[toward]
    if px * dx + py * dy >= 0:
        return px, py
    return -px, -py


def _c6_side(ctx, name, points, stations, side, min_frac) -> tuple[Row, Optional[list[bool]]]:
    item = f"C6:{name}:side-{side.get('toward')}"
    if not ctx.relief:
        return Row(item, SKIP, "bundle declares relief: false (spec D)"), None
    toward = side.get("toward")
    if toward not in COMPASS:
        return Row(item, SKIP, f"unknown toward {toward!r}"), None
    a, b = (float(v) for v in side.get("offset_u", [1, 3]))
    lo, hi = (float(v) for v in side.get("elevation_m", [0, 1e9]))
    stat = side.get("stat", "median")
    step = 1.0 / ctx.ppu
    ok_count = 0
    oks: list[bool] = []
    for idx in range(len(stations)):
        _, x, y = stations[idx]
        px, py = _side_direction(points, stations, idx, toward)
        vals = []
        off = a
        while off <= b + 1e-9:
            sx, sy = x + off * px, y + off * py
            if 0.0 <= sx < ctx.width_u and 0.0 <= sy < ctx.height_u:
                vals.append(ctx.elev[int(sy * ctx.ppu), int(sx * ctx.ppu)])
            off += step
        if not vals:
            oks.append(False)
            continue
        value = float(np.max(vals)) if stat == "max" else float(np.median(vals))
        oks.append(lo <= value <= hi)
        ok_count += oks[-1]
    frac = ok_count / len(stations)
    return Row(item, _result(frac >= min_frac),
               f"{ok_count}/{len(stations)} stations ({frac:.2f} >= {min_frac}) with {stat} "
               f"over offset [{a},{b}] toward {toward} in [{lo:.0f},{hi:.0f}] m"), oks


def _c6_on_line(ctx, name, points, stations, spec, min_frac) -> tuple[Row, Optional[list[bool]]]:
    item = f"C6:{name}:on_line"
    if not ctx.relief:
        return Row(item, SKIP, "bundle declares relief: false (spec D)"), None
    lo, hi = (float(v) for v in spec.get("elevation_m", [0, 1e9]))
    stat = spec.get("stat", "max")
    ok_count = 0
    oks: list[bool] = []
    for _, x, y in stations:
        disk = ctx.disk(x, y, 1.0)
        if disk is None:
            oks.append(False)
            continue
        vals = ctx.elev[disk]
        value = float(np.max(vals)) if stat == "max" else float(np.median(vals))
        oks.append(lo <= value <= hi)
        ok_count += oks[-1]
    frac = ok_count / len(stations)
    return Row(item, _result(frac >= min_frac),
               f"{ok_count}/{len(stations)} stations ({frac:.2f} >= {min_frac}) with {stat} "
               f"of 1-u disk in [{lo:.0f},{hi:.0f}] m"), oks


def _c6_water_within(ctx, name, points, stations, spec, min_frac) -> tuple[Row, Optional[list[bool]]]:
    item = f"C6:{name}:water_within"
    toward = spec.get("toward")
    if toward not in COMPASS:
        return Row(item, SKIP, f"unknown toward {toward!r}"), None
    max_u = float(spec.get("max_u", 60))
    step = 1.0 / ctx.ppu
    ok_count = 0
    oks: list[bool] = []
    for idx in range(len(stations)):
        _, x, y = stations[idx]
        px, py = _side_direction(points, stations, idx, toward)
        found = False
        off = step
        while off <= max_u + 1e-9:
            sx, sy = x + off * px, y + off * py
            if not (0.0 <= sx < ctx.width_u and 0.0 <= sy < ctx.height_u):
                break
            if ctx.water[int(sy * ctx.ppu), int(sx * ctx.ppu)]:
                found = True
                break
            off += step
        oks.append(found)
        ok_count += found
    frac = ok_count / len(stations)
    return Row(item, _result(frac >= min_frac),
               f"{ok_count}/{len(stations)} stations ({frac:.2f} >= {min_frac}) with water "
               f"toward {toward} within {max_u:.0f} u"), oks


# ---------------------------------------------------------------------------
# C8: water topology and coast (spec C8). Native resolution.
# ---------------------------------------------------------------------------

def check_c8(ctx: Context) -> list[Row]:
    """C8: (a) one Basin, (b) one mouth, (c) coast agreement with the canon mask."""
    coast = ctx.constraints.get("coast")
    if not coast:
        return [Row("C8", SKIP, "no coast section in constraints")]
    canon = ctx.cached("canon_mask", lambda: rasterize_mask(
        canon_land_geometry(ctx.manifest, ctx.geometry), ctx.ppu,
        ctx.width_u, ctx.height_u))
    if canon.shape != ctx.elev.shape:
        canon = canon[: ctx.rows, : ctx.cols]
    basin_geom = ctx.basin_geom
    if basin_geom is None:
        return [Row("C8", SKIP, "manifest has no aethelian_basin polygon")]
    in_basin_poly = ctx.cached("basin_poly_mask", lambda: rasterize_mask(
        basin_geom, ctx.ppu, ctx.width_u, ctx.height_u))
    water = ctx.water
    rows = []
    rows.extend(_c8a(ctx, coast, canon, in_basin_poly, water, basin_geom))
    rows.append(_c8b(ctx, coast, in_basin_poly, water))
    rows.extend(_c8c(ctx, coast, canon, water))
    return rows


def _c8a(ctx, coast, canon, in_basin_poly, water, basin_geom) -> list[Row]:
    """C8(a): one 4-connected Basin component holding 95% of Basin-polygon water,
    and its area within +-area_tol of the polygon area."""
    basin_water = in_basin_poly & water
    n_basin_water = int(basin_water.sum())
    if n_basin_water == 0:
        return [Row("C8a:connectivity", SKIP, "zero Basin-polygon water pixels; no samples"),
                Row("C8a:area", SKIP, "zero Basin-polygon water pixels; no samples")]
    labels4, _ = ndimage.label(water, structure=CONN4)
    comp_sizes = np.bincount(labels4[basin_water].ravel())
    largest_frac = comp_sizes.max() / n_basin_water
    conn_ok = largest_frac >= 0.95
    area_tol = float(coast.get("basin_area_tol", 0.15))
    basin_comp = comp_sizes.argmax()
    # The Basin joins the ocean at Halkar, so its component also holds the
    # ocean; the measurable "Basin surface area" is that component's water
    # inside the Basin polygon (spec C8a).
    comp_area_u2 = int((basin_water & (labels4 == basin_comp)).sum()) / ctx.ppu ** 2
    poly_area_u2 = float(basin_geom.area)
    if poly_area_u2 <= 0:
        area_row = Row("C8a:area", SKIP, "Basin polygon has zero area")
    else:
        rel = abs(comp_area_u2 - poly_area_u2) / poly_area_u2
        area_row = Row("C8a:area", _result(rel <= area_tol),
                       f"Basin component area {comp_area_u2:.0f} u^2 vs polygon "
                       f"{poly_area_u2:.0f} u^2 (rel diff {rel:.2f} <= {area_tol})")
    return [Row("C8a:connectivity", _result(conn_ok),
                f"{largest_frac:.3f} of Basin-polygon water in one component (>=0.95)"),
            area_row]


def _c8b(ctx, coast, in_basin_poly, water) -> Row:
    """C8(b): removing the mouth_cut disk disconnects the Basin from outside water."""
    cut = coast.get("mouth_cut") or {}
    point_id = cut.get("point")
    try:
        x, y = resolve_point(ctx.manifest, point_id)
    except (KeyError, TypeError):
        return Row("C8b:mouth", SKIP, f"mouth_cut point {point_id!r} does not resolve")
    radius = float(cut.get("r_u", 15))
    water_cut = water.copy()
    disk = ctx.disk(x, y, radius)
    if disk is not None:
        water_cut[disk] = False
    basin_water = in_basin_poly & water_cut
    if not basin_water.any():
        return Row("C8b:mouth", SKIP, "no Basin water left after mouth cut; no samples")
    labels4, _ = ndimage.label(water_cut, structure=CONN4)
    # every post-cut component holding Basin water, not only the largest (Sol review)
    comps = np.unique(labels4[basin_water])
    comp = np.isin(labels4, comps[comps > 0])
    leaks = int((comp & ~in_basin_poly).sum())
    return Row("C8b:mouth", _result(leaks == 0),
               f"after mouth cut r={radius} u at {point_id!r}: {leaks} Basin-component "
               f"water pixels outside the Basin polygon")


def _c8c(ctx, coast, canon, water) -> list[Row]:
    """C8(c): coast agreement outside free_zones and the coast band."""
    band_u = float(coast.get("coast_band_u", 6))
    min_agree = float(coast.get("min_agree", 0.97))
    excluded = np.zeros(ctx.elev.shape, dtype=bool)
    for zone in coast.get("free_zones", []):
        excluded |= rect_mask(ctx.ppu, zone.get("x_range"), zone.get("y_range"),
                              ctx.width_u, ctx.height_u)
    # band either side of the canon coastline (pixel units, then converted)
    canon_boundary = canon ^ ndimage.binary_erosion(canon, structure=CONN4, border_value=0)
    dist_px = ndimage.distance_transform_edt(~canon_boundary)
    excluded |= dist_px <= band_u * ctx.ppu
    rows = []
    for label, canon_side, bundle_side in (
            ("land", canon, ~water),
            ("water", ~canon, water)):
        sel = canon_side & ~excluded
        n_sel = int(sel.sum())
        if n_sel == 0:
            rows.append(Row(f"C8c:{label}", SKIP,
                            f"zero canon-{label} pixels outside free zones/coast band"))
            continue
        agree = int((sel & bundle_side).sum()) / n_sel
        rows.append(Row(f"C8c:{label}", _result(agree >= min_agree),
                        f"{agree:.4f} of canon-{label} pixels agree (>= {min_agree}) "
                        f"over {n_sel} pixels"))
    return rows


# ---------------------------------------------------------------------------
# C9: region cores (spec C9). Coarse relief.
# ---------------------------------------------------------------------------

def check_c9(ctx: Context) -> list[Row]:
    """C9: percentile bands of land elevation inside eroded (and clipped) cores."""
    if not ctx.relief:
        return [Row("C9", SKIP, "bundle declares relief: false (spec D)")]
    cores = ctx.constraints.get("region_cores", {})
    if not cores:
        return [Row("C9", SKIP, "no region_cores entries in constraints")]
    elev_c, water_c = ctx.coarse
    rows = []
    for name, entry in cores.items():
        item = f"C9:{name}"
        ref = entry.get("shape")
        try:
            geom = resolve_shape(ctx.manifest, ctx.geometry, ref)
        except KeyError as exc:
            rows.append(Row(item, SKIP, str(exc)))
            continue
        eroded = erode_and_clip(geom, float(entry.get("erode_u", 20)),
                                entry.get("x_range"), entry.get("y_range"))
        mask = rasterize_mask(eroded, 1, ctx.width_u, ctx.height_u)
        if mask.shape != elev_c.shape:
            mask = mask[: elev_c.shape[0], : elev_c.shape[1]]
        sel = mask & ~water_c
        n_sel = int(sel.sum())
        if n_sel == 0:
            rows.append(Row(item, SKIP, "zero land cells inside the eroded core; no samples"))
            continue
        failures = []
        vals = elev_c[sel]
        for key, band in entry.items():
            if not (isinstance(key, str) and key.startswith("p") and isinstance(band, (list, tuple))):
                continue
            p = float(key[1:])
            value = float(np.percentile(vals, p))
            lo, hi = float(band[0]), float(band[1])
            if not (lo <= value <= hi):
                failures.append(f"p{p:g} {value:.1f} m outside [{lo:.0f},{hi:.0f}]")
        detail = "; ".join(failures) if failures else (
            f"{n_sel} land cells in core; all percentile bands hold")
        rows.append(Row(item, FAIL if failures else PASS, detail))
    return rows


# ---------------------------------------------------------------------------
# Reporting and CLI (spec C).
# ---------------------------------------------------------------------------

CHECKS: dict[str, Callable[[Context], list[Row]]] = {
    "C1": check_c1,
    "C2": check_c2,
    "C3": check_c3,
    "C4": check_c4,
    "C5": check_c5,
    "C6": check_c6,
    "C8": check_c8,
    "C9": check_c9,
}

CHECK_TITLES = {
    "C1": "Point class (spec C1)",
    "C2": "Point elevation bands (spec C2)",
    "C3": "Routes (spec C3)",
    "C4": "Convergent rivers (spec C4)",
    "C5": "Ndjadi outlet and distributaries (spec C5)",
    "C6": "Hard-line profiles (spec C6)",
    "C8": "Water topology and coast (spec C8)",
    "C9": "Region cores (spec C9)",
}


def aggregate(rows: list[Row]) -> str:
    """Worst result of a check: FAIL > SKIP > PASS."""
    results = {r.result for r in rows}
    if FAIL in results:
        return FAIL
    if SKIP in results:
        return SKIP
    return PASS


def run_checks(ctx: Context, selected: list[str]) -> dict[str, list[Row]]:
    return {name: CHECKS[name](ctx) for name in selected}


def _print_table(name: str, rows: list[Row]) -> None:
    print(f"\n== {name} {CHECK_TITLES.get(name, '')} [{aggregate(rows)}] ==")
    width = max([len(r.item) for r in rows] + [4])
    print(f"  {'item'.ljust(width)}  result  detail")
    print(f"  {'-' * width}  ------  ------")
    for r in rows:
        detail = r.detail if r.result != SKIP else f"SKIP: {r.detail}"
        print(f"  {r.item.ljust(width)}  {r.result.ljust(6)}  {detail}")


def write_json(results: dict[str, list[Row]], path, meta: dict, warnings: list[str]) -> None:
    doc = {
        "bundle": meta.get("bundle", ""),
        "ppu": meta.get("ppu"),
        "relief": meta.get("relief"),
        "warnings": warnings,
        "checks": {
            name: {
                "result": aggregate(rows),
                "rows": [{"item": r.item, "result": r.result, "detail": r.detail}
                         for r in rows],
            }
            for name, rows in results.items()
        },
    }
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")


def _md_escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def write_markdown(results: dict[str, list[Row]], path, meta: dict, warnings: list[str]) -> None:
    lines = ["# Terrain validation report", ""]
    lines.append(f"- Bundle: `{meta.get('bundle', '')}`")
    lines.append(f"- px_per_unit: {meta.get('ppu')}, relief: {meta.get('relief')}")
    for w in warnings:
        lines.append(f"- WARNING: {_md_escape(w)}")
    lines.append("")
    for name, rows in results.items():
        lines.append(f"## {name} — {CHECK_TITLES.get(name, '')} "
                     f"**[{aggregate(rows)}]**")
        lines.append("")
        lines.append("| item | result | detail |")
        lines.append("|------|--------|--------|")
        for r in rows:
            detail = r.detail if r.result != SKIP else f"SKIP: {r.detail}"
            lines.append(f"| {_md_escape(r.item)} | {r.result} | {_md_escape(detail)} |")
        lines.append("")
    Path(path).write_text("\n".join(lines), encoding="utf-8")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m generator.terrain.validate",
        description="Validate a Phase 2 terrain bundle (spec PHASE2-SPEC.md B/C).")
    parser.add_argument("bundle", help="bundle directory holding terrain.json and elevation.npy")
    parser.add_argument("--constraints", default=str(REPO_ROOT / "data" / "terrain-constraints.yaml"))
    parser.add_argument("--manifest", default=str(REPO_ROOT / "data" / "coordinate-manifest.yaml"))
    parser.add_argument("--geometry", default=str(REPO_ROOT / "data" / "terrain-geometry.yaml"))
    parser.add_argument("--checks", default=None,
                        help="comma-separated checks to run (default: all)")
    parser.add_argument("--json", dest="json_out", default=None, help="write JSON report")
    parser.add_argument("--md", dest="md_out", default=None, help="write Markdown report")
    args = parser.parse_args(argv)

    try:
        bundle = load_bundle(args.bundle)
    except PreflightError as exc:
        print(f"PREFLIGHT REJECTED: {exc}", file=sys.stderr)
        return 2

    constraints = load_yaml(args.constraints)
    manifest = load_yaml(args.manifest)
    geometry = load_yaml(args.geometry)

    warnings = []
    declared = bundle.meta.get("constraints_sha256")
    import hashlib
    actual = hashlib.sha256(Path(args.constraints).read_bytes()).hexdigest()
    if declared != actual:
        warnings.append(f"constraints_sha256 mismatch: bundle declares "
                        f"{str(declared)[:12]}..., {Path(args.constraints).name} is "
                        f"{actual[:12]}...")

    ctx = Context(
        elev=bundle.elevation,
        ppu=bundle.ppu,
        relief=bundle.relief,
        sea_level=bundle.sea_level,
        constraints=constraints,
        manifest=manifest,
        geometry=geometry,
        bundle_path=str(args.bundle),
    )

    if args.checks:
        selected = [c.strip().upper() for c in args.checks.split(",") if c.strip()]
        unknown = [c for c in selected if c not in CHECKS]
        if unknown:
            print(f"unknown checks: {', '.join(unknown)} (known: {', '.join(CHECKS)})",
                  file=sys.stderr)
            return 2
    else:
        selected = list(CHECKS)

    results = run_checks(ctx, selected)
    meta = {"bundle": str(args.bundle), "ppu": bundle.ppu, "relief": bundle.relief}
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)
    for name, rows in results.items():
        _print_table(name, rows)
    if args.json_out:
        write_json(results, args.json_out, meta, warnings)
        print(f"\nJSON report written to {args.json_out}")
    if args.md_out:
        write_markdown(results, args.md_out, meta, warnings)
        print(f"Markdown report written to {args.md_out}")

    any_fail = any(r.result == FAIL for rows in results.values() for r in rows)
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
