"""S4 hydro skeleton and S5 floodplain surface (PHASE3-SPEC sections S4, S5).

Everything here lives on the coarse grid (1 px/unit), which is the grid the
validator routes on. The coarse classes are the validator's own pooling of
the fine S2 mask (`Context.coarse`), never a second opinion.

S4 builds a directed tree of coarse cells (the canon rivers, merged where
they run within `merge_u` of each other, a trunk down one distributary to a
single Basin outlet) and gives every cell a fixed elevation that falls
strictly downstream. S5 builds the hydro lock set `Lk` and a surface on it
that has no pits by arithmetic: frozen sources (skeleton, fan, levee ring)
and a shortest-path field over the rest.

The gates never trust this module's own receivers. They hand the raster to
the validator's flood and lowest-neighbour routing and read the result.

Deviations from the frozen spec are listed in the module-level DEVIATIONS
tuple and repeated in the M2 pull request.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import Polygon

from . import mask as M
from . import validate as V
from .canon import (
    FRAME_H_U,
    FRAME_W_U,
    basin_polygon,
    erode_and_clip,
    rasterize_mask,
    resolve_point,
    resolve_shape,
)
from .protect import GateError, Protection, _disk_raster

ROWS, COLS = FRAME_H_U, FRAME_W_U
SHAPE = (ROWS, COLS)
N8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
BOX3 = np.ones((3, 3), dtype=bool)
WATER_M = -50.0  # flat sea floor until S10 (bathy)

DEVIATIONS = (
    "S4.3: the chains that do not pass through the neck cell join the "
    "through-chain at its downstream end (the confluence, inside the neck "
    "disk) instead of doubling back to the neck cell.",
    "S4.5: a trunk cell's height is T(y) at the polyline's own y inside the "
    "cell, not T(row), so cells that share a row still fall strictly.",
    "S5.5: s_plain uses the highest source actually on Lk (entry cones "
    "included) in place of the constant 36.3.",
    "S8.6 (class rule) pulled forward: delta-front blocks that pool to "
    "water with their centre outside the Basin polygon are given land "
    "pixels here, because S4 already needs the coarse classes.",
)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def flat(r: int, c: int) -> int:
    return r * COLS + c


def unflat(cell: int) -> tuple[int, int]:
    return divmod(cell, COLS)


def _step(a: int, b: int) -> float:
    ra, ca = unflat(a)
    rb, cb = unflat(b)
    return math.hypot(ra - rb, ca - cb)


def _neighbours(cell: int):
    r, c = unflat(cell)
    for dr, dc in N8:
        nr, nc = r + dr, c + dc
        if 0 <= nr < ROWS and 0 <= nc < COLS:
            yield nr * COLS + nc


def dense(points, step: float) -> np.ndarray:
    """A polyline resampled every `step` units, last vertex included."""
    pts = [(float(x), float(y)) for x, y in points]
    out = [(x, y) for _, x, y in V._polyline_samples(pts, step)]
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return np.asarray(out, dtype=np.float64)


def arc(pts: np.ndarray) -> np.ndarray:
    seg = np.diff(pts, axis=0)
    return np.concatenate([[0.0], np.cumsum(np.hypot(seg[:, 0], seg[:, 1]))])


def _resample_n(pts: np.ndarray, n: int) -> np.ndarray:
    s = arc(pts)
    t = np.linspace(0.0, s[-1], n)
    return np.column_stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])])


def chain_cells(points, step: float = 0.1) -> tuple[list[int], list[float]]:
    """Rasterise a polyline to a thin 8-connected chain of coarse cells.

    Returns the cells in polyline order and, for each, the mean y of the
    polyline samples inside it. A cell revisited later erases the loop
    between the two visits. A cell whose two chain neighbours already touch
    is dropped, so no cell touches a chain cell two steps away.
    """
    cells: list[int] = []
    ysum: list[float] = []
    count: list[int] = []
    index: dict[int, int] = {}
    for x, y in dense(points, step):
        r, c = int(y), int(x)
        if not (0 <= r < ROWS and 0 <= c < COLS):
            raise GateError("S4", f"a chain leaves the frame at ({x:.1f},{y:.1f})")
        cell = r * COLS + c
        if cells and cell == cells[-1]:
            ysum[-1] += y
            count[-1] += 1
            continue
        if cell in index:
            keep = index[cell] + 1
            for dead in cells[keep:]:
                del index[dead]
            del cells[keep:], ysum[keep:], count[keep:]
            continue
        index[cell] = len(cells)
        cells.append(cell)
        ysum.append(y)
        count.append(1)
    i = 0
    while i + 2 < len(cells):
        if _step(cells[i], cells[i + 2]) < 1.5:
            del cells[i + 1], ysum[i + 1], count[i + 1]
            i = max(i - 1, 0)
        else:
            i += 1
    for a, b in zip(cells, cells[1:]):
        if _step(a, b) > 1.5:
            raise GateError("S4", "a rasterised chain is not 8-connected")
    return cells, [s / n for s, n in zip(ysum, count)]


# ---------------------------------------------------------------------------
# Coarse classes and the delta-front class rule
# ---------------------------------------------------------------------------

def coarse_water(mask: np.ndarray, ppu: int) -> np.ndarray:
    """The validator's pooled water class for a fine land mask."""
    ctx = V.Context(elev=M.flat_elevation(mask), ppu=ppu, relief=False,
                    sea_level=0.0, constraints={}, manifest={}, geometry={})
    return ctx.coarse[1]


def _distributaries(manifest: dict, constraints: dict) -> dict[str, list]:
    out = {}
    for rid, entry in constraints.get("rivers", {}).items():
        if entry.get("kind") == "distributary":
            out[rid] = [(float(x), float(y)) for x, y in manifest["rivers"][rid]["path"]]
    return out


def _convergent(manifest: dict, constraints: dict) -> dict[str, list]:
    out = {}
    for rid, entry in constraints.get("rivers", {}).items():
        if entry.get("kind") == "convergent":
            out[rid] = [(float(x), float(y)) for x, y in manifest["rivers"][rid]["path"]]
    return out


def _cell_centres() -> tuple[np.ndarray, np.ndarray]:
    return np.meshgrid(np.arange(COLS) + 0.5, np.arange(ROWS) + 0.5)


def front_fix(mask: np.ndarray, prot: Protection, manifest: dict,
              constraints: dict, params: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    """Delta-front class rule (spec S8.6, section 7 "mouths 1 u inside").

    The validator calls a block water when half its pixels are negative and
    then asks whether the block's centre is inside the Basin polygon. A
    front block of Basin water whose centre is outside the polygon would
    count as ocean. Each such block within the delta-front zone is given
    land pixels until it pools to land. The land advances into the polygon,
    which the one-sided shore allows.

    A sea route's corridor buffer is optional water (spec S1), so the rule
    may release its pixels; kept route samples, mouth reservations and
    witnesses are never touched. A block those alone keep wet is left as it
    is and counted: it stays water the plain may not drain into, the shore
    rim keeps Lk off it, and Gate S4 stops if the trunk runs beside it.

    Returns (mask, released, counts): `released` marks the buffer pixels
    that left P_water.
    """
    ppu = prot.ppu
    released = np.zeros(mask.shape, dtype=bool)
    counts = {"fixed": 0, "left_protected": 0, "buffer_pixels_released": 0}
    if ppu == 1:
        return mask, released, counts
    water = ~mask
    blocks = water.reshape(ROWS, ppu, COLS, ppu)
    water_c = blocks.mean(axis=(1, 3)) >= 0.5
    centre_in = rasterize_mask(basin_polygon(manifest), 1)
    spills = (water & ~prot.in_basin_poly).reshape(ROWS, ppu, COLS, ppu).any(axis=(1, 3))
    xx, yy = _cell_centres()
    zone = np.zeros(SHAPE, dtype=bool)
    reach = float(params["s2"]["delta_front_zone_u"])
    for path in _distributaries(manifest, constraints).values():
        mx, my = path[-1]
        zone |= (xx - mx) ** 2 + (yy - my) ** 2 <= reach * reach
    straddlers = np.argwhere(water_c & ~centre_in & ~spills & zone)
    if straddlers.size == 0:
        return mask, released, counts
    hard = prot.p_water
    if prot.p_water_buffer is not None:
        hard = hard & ~prot.p_water_buffer
    out = mask.copy()
    to_land = ndimage.distance_transform_edt(water)
    max_water = math.ceil(ppu * ppu / 2) - 1
    for r, c in straddlers:
        rs, cs = slice(r * ppu, (r + 1) * ppu), slice(c * ppu, (c + 1) * ppu)
        block_water = water[rs, cs]
        flips = int(block_water.sum()) - max_water
        free = block_water & ~hard[rs, cs]
        if int(free.sum()) < flips:
            counts["left_protected"] += 1
            continue
        # nearest the land first; unprotected water before buffer water
        cost = to_land[rs, cs] + np.where(prot.p_water[rs, cs], 1e6, 0.0)
        order = np.argsort(np.where(free, cost, np.inf).ravel(), kind="stable")
        block = out[rs, cs].copy()  # a contiguous copy, so ravel() is a view of it
        block.ravel()[order[:flips]] = True
        out[rs, cs] = block
        counts["fixed"] += 1
    released = out & prot.p_water
    counts["buffer_pixels_released"] = int(released.sum())
    return out, released, counts


# ---------------------------------------------------------------------------
# S4.1 and S4.2: canon chains and the merge rule (on polylines)
# ---------------------------------------------------------------------------

@dataclass
class Branch:
    pts: np.ndarray  # dense samples, source first
    rivers: tuple[str, ...]
    down: Optional["Branch"] = None  # the merged branch this one flows into


def _first_contact(a: np.ndarray, b: np.ndarray, reach: float) -> Optional[tuple[int, int]]:
    """First sample of each polyline that lies within `reach` of the other."""
    da, _ = cKDTree(b).query(a)
    db, _ = cKDTree(a).query(b)
    ia, ib = np.nonzero(da <= reach)[0], np.nonzero(db <= reach)[0]
    if ia.size == 0 or ib.size == 0:
        return None
    return int(ia[0]), int(ib[0])


def merge_rivers(paths: dict[str, list], merge_u: float,
                 step: float = 0.25) -> tuple[list[Branch], list[Branch]]:
    """S4.2: no two chains run side by side.

    From the first point where two polylines come within `merge_u`, both are
    replaced downstream by one shared line on their weighted midline (weight
    = canon rivers carried). The pair whose shared reach is longest merges
    first, so a three-way bundle zips from its upstream end. Returns the
    open branches (free downstream end) and the arms (each flows into a
    merged branch), arms in creation order.
    """
    open_: list[Branch] = [Branch(dense(p, step), (rid,)) for rid, p in sorted(paths.items())]
    arms: list[Branch] = []
    while True:
        best = None
        for i in range(len(open_)):
            for j in range(i + 1, len(open_)):
                contact = _first_contact(open_[i].pts, open_[j].pts, merge_u)
                if contact is None:
                    continue
                ka, kb = contact
                shared = max(arc(open_[i].pts[ka:])[-1], arc(open_[j].pts[kb:])[-1])
                key = (-shared, i, j)
                if best is None or key < best[0]:
                    best = (key, i, j, ka, kb)
        if best is None:
            return open_, arms
        _, i, j, ka, kb = best
        a, b = open_[i], open_[j]
        if ka < 2 or kb < 2:
            raise GateError(
                "S4", f"chains {a.rivers} and {b.rivers} start within {merge_u} u "
                      f"of each other: the merge rule has no upstream arm to keep")
        la, lb = arc(a.pts[ka:])[-1], arc(b.pts[kb:])[-1]
        n = int(math.ceil(max(la, lb) / step)) + 1
        wa, wb = len(a.rivers), len(b.rivers)
        mid = (wa * _resample_n(a.pts[ka:], n) + wb * _resample_n(b.pts[kb:], n)) / (wa + wb)
        merged = Branch(dense(mid, step), a.rivers + b.rivers)
        arms.append(Branch(np.vstack([a.pts[:ka], merged.pts[:1]]), a.rivers, merged))
        arms.append(Branch(np.vstack([b.pts[:kb], merged.pts[:1]]), b.rivers, merged))
        open_ = [x for k, x in enumerate(open_) if k not in (i, j)] + [merged]


def _snap_through(pts: np.ndarray, target: tuple[float, float], window_u: float) -> np.ndarray:
    """Bend a polyline so it passes exactly through `target` (tent blend)."""
    d = np.hypot(pts[:, 0] - target[0], pts[:, 1] - target[1])
    k = int(np.argmin(d))
    s = arc(pts)
    weight = np.clip(1.0 - np.abs(s - s[k]) / window_u, 0.0, 1.0)
    out = pts.copy()
    out[:, 0] += (target[0] - pts[k, 0]) * weight
    out[:, 1] += (target[1] - pts[k, 1]) * weight
    return out


# ---------------------------------------------------------------------------
# S4: the skeleton
# ---------------------------------------------------------------------------

@dataclass
class Skeleton:
    parent: dict[int, int]  # skeleton cell -> downstream cell (the root for the last land cell)
    height: dict[int, float]
    root: int  # the outlet water cell
    plain: set[int]  # skeleton cells on the plain (everything but headwater extensions)
    ext: dict[str, list[int]]  # river id -> headwater extension cells, entry side first
    entries: dict[str, int]  # river id -> entry cell (the validator's snap)
    river_paths: dict[str, list[int]]  # river id -> entry .. last land cell
    trunk: list[int]  # the trunk distributary's land cells, apex first
    t_y_last: float  # T(y) = last_land_m + (y - t_y_last) * t_slope
    t_slope: float
    last_land_m: float
    neck_cell: int
    confluence: tuple[float, float]
    upstream_dir: dict[str, tuple[float, float]] = field(default_factory=dict)

    def trunk_line(self, y: float) -> float:
        """The trunk profile T(y), extended by the same line to any y."""
        return self.last_land_m + (y - self.t_y_last) * self.t_slope


def front_water(water_c: np.ndarray, manifest: dict, constraints: dict,
                params: dict) -> np.ndarray:
    """Coarse water the plain may drain into: Basin water (centre in the
    polygon) within `outlet_r_u - outlet_margin_u` of the outlet port."""
    outlet = constraints["ndjadi_outlet"]
    ox, oy = resolve_point(manifest, outlet["outlet_near"])
    reach = float(outlet.get("outlet_r_u", 90)) - float(params["s4"]["outlet_margin_u"])
    xx, yy = _cell_centres()
    centre_in = rasterize_mask(basin_polygon(manifest), 1)
    return water_c & centre_in & ((xx - ox) ** 2 + (yy - oy) ** 2 <= reach * reach)


def build_skeleton(water_c: np.ndarray, front: np.ndarray, macro: np.ndarray,
                   manifest: dict, constraints: dict, params: dict) -> Skeleton:
    """S4.1 to S4.6: chains, merge rule, trunk, outlet, long profiles,
    headwater extensions."""
    s4 = params["s4"]
    outlet = constraints["ndjadi_outlet"]
    neck = resolve_point(manifest, outlet["neck"])
    neck_r = float(outlet.get("neck_r_u", 12))
    rivers = _convergent(manifest, constraints)
    trunk_path = _distributaries(manifest, constraints)[s4["trunk_distributary"]]
    elev_flat = np.where(water_c, WATER_M, 100.0)

    parent: dict[int, int] = {}
    depth: dict[int, int] = {}

    # -- trunk and outlet (S4.3, S4.4) ---------------------------------------
    cells, ymean = chain_cells(trunk_path)
    wet = [k for k, cell in enumerate(cells) if water_c.ravel()[cell]]
    if not wet or wet[0] == 0:
        raise GateError("S4", "the trunk distributary does not run from land into water")
    n_land = wet[0]
    root = cells[n_land]
    if not front.ravel()[root]:
        r, c = unflat(root)
        raise GateError(
            "S4", f"the trunk's outlet cell ({c},{r}) is not Basin water near the "
                  f"outlet port by the validator's rule")
    trunk, trunk_y = cells[:n_land], ymean[:n_land]
    depth[root] = 0
    for k in range(n_land - 1, -1, -1):
        parent[trunk[k]] = trunk[k + 1] if k + 1 < n_land else root
        depth[trunk[k]] = depth[parent[trunk[k]]] + 1

    def attach(chain: list[int]) -> None:
        """Hang a source-first chain on the tree at its first cell that is in
        the tree or touches it."""
        for k, cell in enumerate(chain):
            if cell in parent:
                seq, target = chain[:k], cell
                break
            touching = [n for n in _neighbours(cell) if n in parent]
            if touching:
                seq = chain[:k + 1]
                target = min(touching, key=lambda n: (depth[n], n))
                break
        else:
            raise GateError("S4", "a chain never reaches the tree")
        for k in range(len(seq) - 1, -1, -1):
            cell = seq[k]
            parent[cell] = seq[k + 1] if k + 1 < len(seq) else target
            depth[cell] = depth[parent[cell]] + 1

    # -- canon chains and the merge rule (S4.1, S4.2) -------------------------
    open_, arms = merge_rivers(rivers, float(s4["merge_u"]))
    gaps = [float(np.hypot(b.pts[:, 0] - neck[0], b.pts[:, 1] - neck[1]).min()) for b in open_]
    through = open_[int(np.argmin(gaps))]
    if min(gaps) > float(s4["neck_pass_u"]):
        raise GateError(
            "S4", f"no chain passes within {s4['neck_pass_u']} u of the neck "
                  f"(nearest {min(gaps):.1f} u)")
    # bend it through the centre of the cell holding the neck (C5c starts
    # there); the pin itself sits on a cell corner
    neck_centre = (int(neck[0]) + 0.5, int(neck[1]) + 0.5)
    through.pts = _snap_through(through.pts, neck_centre, 3.0 * float(s4["neck_pass_u"]))
    confluence = (float(through.pts[-1, 0]), float(through.pts[-1, 1]))
    if math.hypot(confluence[0] - neck[0], confluence[1] - neck[1]) > neck_r:
        raise GateError("S4", "the chains do not join inside the neck disk")
    apex = trunk_path[0]

    entries: dict[str, int] = {}
    for rid, path in rivers.items():
        cell = V._nearest_land_cell(elev_flat, water_c, path[0][0], path[0][1])
        if cell is None:
            raise GateError("S4", f"river {rid!r}: no land cell to snap the entry to")
        entries[rid] = cell

    def raster(branch: Branch, tail: Optional[tuple[float, float]]) -> list[int]:
        pts = branch.pts if tail is None else np.vstack([branch.pts, [tail]])
        chain, _ = chain_cells(pts)
        # A branch that starts at a canon entry starts at the validator's cell.
        if len(branch.rivers) == 1:
            # (An entry pin on a cell corner snaps to any of four cells.)
            head = entries[branch.rivers[0]]
            if head in chain[:3]:
                chain = chain[chain.index(head):]
            elif _step(head, chain[0]) < 1.5:
                # keep the chain thin: go on from the last cell the head touches
                last = max(k for k in range(min(4, len(chain)))
                           if _step(head, chain[k]) < 1.5)
                chain = [head] + chain[last:]
            else:
                raise GateError("S4", f"river {branch.rivers[0]!r}: the entry cell "
                                      f"does not touch its chain")
        return chain

    attach(raster(through, apex))
    for branch in open_:
        if branch is not through:
            attach(raster(branch, confluence))
    for branch in reversed(arms):
        attach(raster(branch, None))

    plain = set(parent)
    neck_cell = flat(int(neck[1]), int(neck[0]))
    if neck_cell not in parent:
        raise GateError("S4", "the cell holding the neck is not on the skeleton")

    # -- long profiles (S4.5) ---------------------------------------------------
    last_m = float(s4["last_land_m"])
    apex_m, neck_m = float(params["apex_m"]), float(params["neck_m"])
    top_m = float(params["skeleton_top_m"])
    cap = float(params["river_slope_m_per_u_cap"])
    t_slope = (apex_m - last_m) / (trunk_y[0] - trunk_y[-1])
    height: dict[int, float] = {
        cell: last_m + (y - trunk_y[-1]) * t_slope for cell, y in zip(trunk, trunk_y)}
    trunk_set = set(trunk)

    # the neck's own path down to the trunk: linear in path length to neck_m
    if neck_cell in trunk_set:
        raise GateError("S4", "the neck cell lies on the trunk distributary")
    fixed = [neck_cell]
    while parent[fixed[-1]] not in trunk_set:
        fixed.append(parent[fixed[-1]])
    foot = parent[fixed[-1]]
    if neck_m <= height[foot]:
        raise GateError("S4", "neck_m is not above the trunk where the neck's chain joins it")
    runs, prev = [], foot
    for cell in reversed(fixed):
        runs.append((runs[-1] if runs else 0.0) + _step(prev, cell))
        prev = cell
    for cell, run in zip(reversed(fixed), runs):
        height[cell] = height[foot] + (neck_m - height[foot]) * run / runs[-1]
    pinned = set(height)  # trunk and neck path: heights set from the ends

    children: dict[int, list[int]] = {}
    for cell, down in parent.items():
        children.setdefault(down, []).append(cell)
    by_depth = sorted(parent, key=lambda cell: (depth[cell], cell))
    reach: dict[int, float] = {}  # longest path from a cell up to a leaf
    for cell in reversed(by_depth):
        reach[cell] = max((_step(cell, k) + reach[k] for k in children.get(cell, [])),
                          default=0.0)
    slope: dict[int, float] = {}
    for cell in by_depth:
        if cell in height:
            continue
        down = parent[cell]
        free_kids = [k for k in children[down] if k not in pinned]
        main = max(free_kids, key=lambda k: (_step(down, k) + reach[k], -k))
        if down in slope and cell == main:
            slope[cell] = slope[down]  # same chain
        else:  # a chain starts here: rise from the join, set from the ends
            run = _step(down, cell) + reach[cell]
            slope[cell] = min(cap, (top_m - height[down]) / run)
        height[cell] = height[down] + slope[cell] * _step(down, cell)
    if max(height.values()) > top_m + 1e-9:
        raise GateError("S4", f"a skeleton cell on the plain is above {top_m} m")

    river_paths: dict[str, list[int]] = {}
    for rid, cell in entries.items():
        if cell not in parent:
            raise GateError("S4", f"river {rid!r}: the entry cell is not on the skeleton")
        path = [cell]
        while parent[path[-1]] != root:
            path.append(parent[path[-1]])
        river_paths[rid] = path

    # -- entry fans (S5.5): a cone on the profile where a river enters ----------
    cone_m = float(params["s5"]["entry_cone_m"])
    cone_len = float(params["s5"]["entry_cone_len_u"])
    cone: dict[int, float] = {}
    for path in river_paths.values():
        run = 0.0
        for k, cell in enumerate(path):
            if k:
                run += _step(path[k - 1], cell)
            if run >= cone_len:
                break
            cone[cell] = max(cone.get(cell, 0.0), cone_m * (1.0 - run / cone_len))
    for cell, add in cone.items():
        height[cell] += add

    # -- headwater extensions (S4.6) ------------------------------------------
    ext: dict[str, list[int]] = {}
    updir: dict[str, tuple[float, float]] = {}
    length_u = float(params["headwater_len_u"])
    notch = float(params["headwater_notch_m"])
    for rid, entry in constraints.get("rivers", {}).items():
        if rid not in rivers or entry.get("entry_min_area_km2") is None:
            continue
        pts = dense(rivers[rid], 0.25)
        k = int(np.searchsorted(arc(pts), float(s4["bowl_heading_u"])))
        k = min(max(k, 1), len(pts) - 1)
        ux, uy = pts[0] - pts[k]
        norm = math.hypot(ux, uy)
        ux, uy = ux / norm, uy / norm
        updir[rid] = (float(ux), float(uy))
        # From the entry cell's centre, so the extension leaves on the side
        # away from the chain. Its foot must touch the entry cell and no
        # other chain cell: a foot that touched the chain further down would
        # drain past the entry, and the entry's area is the point (C4).
        er, ec = unflat(entries[rid])
        line, _ = chain_cells([(ec + 0.5, er + 0.5),
                               (ec + 0.5 + ux * length_u, er + 0.5 + uy * length_u)])
        line = [cell for cell in line if cell not in parent]
        while line and any(n in plain and n != entries[rid] for n in _neighbours(line[0])):
            line.pop(0)
        if not line or _step(line[0], entries[rid]) > 1.5:
            raise GateError("S4", f"river {rid!r}: the headwater extension does not "
                                  f"start beside the entry cell alone")
        if any(water_c.ravel()[cell] for cell in line):
            raise GateError("S4", f"river {rid!r}: the headwater extension crosses water")
        head_m = float(macro.ravel()[line[-1]]) - notch
        base_m = height[entries[rid]]
        if head_m <= base_m + cap * length_u:
            raise GateError(
                "S4", f"river {rid!r}: the notch head ({head_m:.0f} m) is not above "
                      f"the entry ({base_m:.0f} m); the upland is too low for a notch")
        run, total = 0.0, _step(entries[rid], line[0]) + sum(
            _step(a, b) for a, b in zip(line, line[1:]))
        prev = entries[rid]
        for cell in line:
            run += _step(prev, cell)
            parent[cell] = prev
            height[cell] = base_m + (head_m - base_m) * run / total
            prev = cell
        ext[rid] = line

    return Skeleton(parent=parent, height=height, root=root, plain=plain, ext=ext,
                    entries=entries, river_paths=river_paths, trunk=trunk,
                    t_y_last=float(trunk_y[-1]), t_slope=float(t_slope),
                    last_land_m=last_m, neck_cell=neck_cell, confluence=confluence,
                    upstream_dir=updir)


def gate_s4(skel: Skeleton, water_c: np.ndarray, front: np.ndarray,
            manifest: dict, constraints: dict, params: dict) -> dict:
    """Gate S4: a tree rooted at the outlet, falling strictly, on land,
    following every canon line, with no two chains side by side."""
    s4 = params["s4"]
    water = water_c.ravel()
    h32 = {cell: float(np.float32(v)) for cell, v in skel.height.items()}

    for cell in skel.parent:
        seen, cur = 0, cell
        while cur != skel.root:
            cur = skel.parent.get(cur)
            seen += 1
            if cur is None or seen > len(skel.parent):
                raise GateError("S4", "the skeleton is not a tree rooted at the outlet")
        if water[cell]:
            r, c = unflat(cell)
            raise GateError("S4", f"skeleton cell ({c},{r}) is water")
        down = skel.parent[cell]
        if down != skel.root and not h32[cell] > h32[down]:
            r, c = unflat(cell)
            raise GateError("S4", f"elevation does not fall downstream at ({c},{r})")
        for n in _neighbours(cell):
            if water[n] and not front.ravel()[n]:
                r, c = unflat(cell)
                raise GateError(
                    "S4", f"skeleton cell ({c},{r}) touches water that is not "
                          f"Basin water near the outlet port")
    if not water[skel.root] or skel.parent[skel.trunk[-1]] != skel.root:
        raise GateError("S4", "the trunk does not end beside its outlet water cell")

    # every canon sample beyond the head skip has a cell of its own path near
    tol = float(s4["skeleton_tol_u"])
    skip = float(constraints.get("defaults", {}).get("river_head_skip_u", 8))
    worst = {}
    for rid, path_cells in skel.river_paths.items():
        tree = cKDTree([((c % COLS) + 0.5, (c // COLS) + 0.5) for c in path_cells])
        pts = [(x, y) for t, x, y in V._polyline_samples(
            [(float(x), float(y)) for x, y in manifest["rivers"][rid]["path"]], 1.0) if t > skip]
        far = float(tree.query(pts)[0].max())
        worst[rid] = far
        if far > tol:
            raise GateError(
                "S4", f"river {rid!r}: a canon sample is {far:.1f} u from its own "
                      f"chain (limit {tol} u)")

    # side by side: cells this close in space must be close kin on the tree
    reach, hops = float(s4["side_by_side_u"]), int(s4["side_by_side_hops"])
    cells = sorted(skel.parent)
    kin = {}
    for cell in cells:
        line, cur = {cell}, cell
        for _ in range(hops):
            cur = skel.parent.get(cur)
            if cur is None or cur == skel.root:
                break
            line.add(cur)
        kin[cell] = line
    tree = cKDTree([((c % COLS) + 0.5, (c // COLS) + 0.5) for c in cells])
    for i, j in sorted(tree.query_pairs(reach)):
        if not (kin[cells[i]] & kin[cells[j]]):
            (ra, ca), (rb, cb) = unflat(cells[i]), unflat(cells[j])
            raise GateError(
                "S4", f"chains run side by side at ({ca},{ra}) and ({cb},{rb}): "
                      f"the merge rule missed them")
    return {"canon_sample_worst_u": worst, "skeleton_cells": len(cells)}


# ---------------------------------------------------------------------------
# S4.6 bowls, S4.7 sinks
# ---------------------------------------------------------------------------

def sink_raster(manifest: dict, constraints: dict, params: dict) -> tuple[np.ndarray, list[dict]]:
    """S4.7: the closed basins, as coarse disks. 0 = none, else 1-based id.
    Shape and floor height belong to S9; S4 only reserves the ground."""
    out = np.zeros(SHAPE, dtype=np.uint8)
    listed = []
    for n, (sid, spec) in enumerate(params["s4"]["sinks"].items(), start=1):
        x, y = resolve_point(manifest, sid)
        radius = spec.get("radius_u")
        if radius is None:
            radius = constraints["points"][sid]["extent_u"]
        out[_disk_raster(SHAPE, 1, x, y, float(radius))] = n
        listed.append({"id": sid, "kind": spec["kind"]})
    return out, listed


def bowl_raster(skel: Skeleton, water_c: np.ndarray, lk: np.ndarray,
                rim: np.ndarray, sinks: np.ndarray, manifest: dict,
                constraints: dict, params: dict) -> np.ndarray:
    """S4.6: one catchment bowl per river with an entry area: a fan on the
    upland behind the entry, plus the extension and the cells beside it
    (those leave Lk: they climb with the notch, not with the plain).
    0 = none, else 1-based id in constraint order."""
    s4 = params["s4"]
    out = np.zeros(SHAPE, dtype=np.uint8)
    xx, yy = _cell_centres()
    radius = float(params["headwater_len_u"])
    cos_half = math.cos(math.radians(float(s4["bowl_half_angle_deg"])))
    km2 = float(constraints.get("meta", {}).get("km_per_unit", 4)) ** 2
    plain_skel = np.zeros(SHAPE, dtype=bool)
    plain_skel.ravel()[list(skel.plain)] = True
    hard = water_c | rim | (sinks > 0) | plain_skel
    for n, (rid, line) in enumerate(skel.ext.items(), start=1):
        x0, y0 = manifest["rivers"][rid]["path"][0]
        ux, uy = skel.upstream_dir[rid]
        dx, dy = xx - float(x0), yy - float(y0)
        dist = np.hypot(dx, dy)
        along = dx * ux + dy * uy
        fan = (dist <= radius) & (along >= cos_half * dist) & (dist > 0)
        beside = np.zeros(SHAPE, dtype=bool)
        beside.ravel()[line] = True
        beside = ndimage.binary_dilation(beside, structure=BOX3)
        bowl = ((fan & ~lk) | beside) & ~hard & (out == 0)
        need = int(s4["bowl_factor"]) * math.ceil(
            float(constraints["rivers"][rid]["entry_min_area_km2"]) / km2)
        if int(bowl.sum()) < need:
            raise GateError(
                "S4", f"river {rid!r}: the catchment bowl holds {int(bowl.sum())} "
                      f"cells, under the {need} it needs")
        out[bowl] = n
    return out


# ---------------------------------------------------------------------------
# S5: the lock set and the floodplain surface
# ---------------------------------------------------------------------------

@dataclass
class Hydro:
    """Everything S4 and S5 fix, for the stages that follow."""

    water_c: np.ndarray  # coarse water (the validator's pooling of the fine mask)
    front: np.ndarray  # coarse water the plain may drain into
    skeleton: Skeleton
    lk: np.ndarray  # the hydro lock set
    rim: np.ndarray  # shore rim: land within reach of other water, outside Lk
    bowls: np.ndarray  # uint8 ids
    sinks: np.ndarray  # uint8 ids
    sink_list: list[dict]
    fan: np.ndarray  # delta fan cells that kept their fan height
    released_water: np.ndarray  # fine: P_water buffer pixels the class rule gave to the land
    coarse: np.ndarray  # float64 coarse elevation (water = WATER_M)
    s_plain: float
    d_max: float
    report: dict = field(default_factory=dict)

    @property
    def built(self) -> np.ndarray:
        """Cells whose elevation S4/S5 constructed: Lk and the bowls."""
        return self.lk | (self.bowls > 0)


def _fan_footprint(land: np.ndarray, front: np.ndarray, manifest: dict,
                   constraints: dict, params: dict) -> np.ndarray:
    """S5.1: the land between the outermost distributaries, widened, and
    carried north to the delta-front shore."""
    s5 = params["s5"]
    paths = sorted(_distributaries(manifest, constraints).values(), key=lambda p: p[-1][0])
    ring = paths[0] + paths[-1][::-1]
    poly = Polygon(ring).buffer(0).buffer(float(s5["fan_widen_u"]))
    fan = rasterize_mask(poly, 1) & land
    # apron: land straight north of a fan cell, up to front water
    reach = int(s5["fan_apron_max_u"])
    for c in np.nonzero(fan.any(axis=0))[0]:
        top = int(np.argmax(fan[:, c]))
        for r in range(top - 1, max(top - 1 - reach, -1), -1):
            if not land[r, c]:
                if front[r, c]:
                    fan[r + 1:top, c] = True
                break
    return fan


def lock_set(skel: Skeleton, water_c: np.ndarray, front: np.ndarray,
             macro: np.ndarray, manifest: dict, geometry: dict,
             constraints: dict, params: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """S5.1 and S5.2: Lk, the shore rim, and the fan footprint."""
    s5 = params["s5"]
    land = ~water_c
    outlet = constraints["ndjadi_outlet"]
    plain_skel = np.zeros(SHAPE, dtype=bool)
    plain_skel.ravel()[list(skel.plain)] = True

    lk = np.zeros(SHAPE, dtype=bool)
    low = land & (macro < float(params["lock_lowland_m"]))
    labels, _ = ndimage.label(low, structure=BOX3)
    neck_label = labels.ravel()[skel.neck_cell]
    if neck_label:
        lk |= labels == neck_label
    floodplain = resolve_shape(manifest, geometry, outlet["floodplain"])
    lk |= rasterize_mask(erode_and_clip(floodplain, float(s5["polygon_erode_u"])), 1)
    lk |= ndimage.binary_dilation(plain_skel, structure=BOX3,
                                  iterations=int(s5["skeleton_halo_cells"]))
    fan = _fan_footprint(land, front, manifest, constraints, params)
    lk |= fan
    lk &= land

    other_water = water_c & ~front
    rim = land & ndimage.binary_dilation(other_water, structure=BOX3,
                                         iterations=int(s5["shore_rim_cells"]))
    lost = plain_skel & rim
    if lost.any():
        r, c = np.argwhere(lost)[0]
        raise GateError("S5", f"skeleton cell ({c},{r}) lies in the shore rim of water "
                              f"the plain must not drain into")
    lk &= ~rim
    fan &= lk
    return lk, rim, fan


def build_surface(skel: Skeleton, lk: np.ndarray, fan: np.ndarray,
                  bowls: np.ndarray, front: np.ndarray, params: dict
                  ) -> tuple[np.ndarray, np.ndarray, float, float]:
    """S5.3 to S5.5: frozen sources and the shortest-path field.

    Returns (surface, fan cells that kept fan height, s_plain, D). The
    surface is NaN outside the built set.
    """
    s5 = params["s5"]
    levee = float(s5["levee_m"])
    built = lk | (bowls > 0)
    skel_h = np.full(SHAPE, np.nan)
    for cell, value in skel.height.items():
        skel_h.ravel()[cell] = value
    is_skel = ~np.isnan(skel_h)
    built |= is_skel

    # levee ring (S5.4): at least levee_m over the highest skeleton cell touched
    touched = ndimage.maximum_filter(np.where(is_skel, skel_h, -np.inf), size=3,
                                     mode="constant", cval=-np.inf)
    ring = built & ~is_skel & np.isfinite(touched)
    levee_h = np.where(ring, touched + levee, np.nan)

    # delta fan (S5.3): T at the row centre plus fan_ground_m, never under the levee
    rows = np.arange(ROWS)[:, None] + 0.5
    fan_h = skel.trunk_line(rows) + float(params["fan_ground_m"]) + np.zeros(SHAPE)
    fan_h = np.maximum(fan_h, float(s5["min_land_m"]))
    fan_h = np.where(ring, np.maximum(fan_h, levee_h), fan_h)
    fan_src = fan & ~is_skel
    # a fan cell keeps its fan height only while a neighbour is strictly lower
    while True:
        lower = np.where(is_skel, skel_h, np.where(fan_src, fan_h, np.inf))
        lower = np.where(front, -np.inf, lower)
        lowest = ndimage.minimum_filter(lower, size=3, mode="constant", cval=np.inf)
        stuck = fan_src & ~(lowest < fan_h)
        if not stuck.any():
            break
        fan_src &= ~stuck

    source = np.where(is_skel, skel_h, np.where(fan_src, fan_h, levee_h))
    is_source = ~np.isnan(source)

    def field_from(start: np.ndarray, cost: np.ndarray) -> np.ndarray:
        """Multi-source shortest path over the built set; sources frozen."""
        out = np.where(is_source, start, np.inf).ravel()
        frozen = is_source.ravel()
        inside = built.ravel()
        step_cost = cost.ravel()
        heap = [(float(out[i]), int(i)) for i in np.nonzero(frozen)[0]]
        heapq.heapify(heap)
        while heap:
            value, cell = heapq.heappop(heap)
            if value > out[cell]:
                continue
            r, c = divmod(cell, COLS)
            for dr, dc in N8:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < ROWS and 0 <= nc < COLS):
                    continue
                n = nr * COLS + nc
                if frozen[n] or not inside[n]:
                    continue
                cand = value + step_cost[n] * (1.4142135623730951 if dr and dc else 1.0)
                if cand < out[n]:
                    out[n] = cand
                    heapq.heappush(heap, (cand, n))
        return out.reshape(SHAPE)

    # s_plain is derived, not chosen (S5.5): the farthest Lk cell stays under plain_max_m
    dist = field_from(np.zeros(SHAPE), np.ones(SHAPE))
    d_max = float(dist[lk & ~is_source & np.isfinite(dist)].max(initial=0.0))
    top_source = float(source[lk & is_source].max())
    plain_max = float(s5["plain_max_m"])
    if top_source >= plain_max:
        raise GateError("S5", f"a source on the plain is at {top_source:.1f} m, "
                              f"over plain_max_m {plain_max}")
    s_plain = float(params["s_plain_m_per_u_cap"])
    if d_max > 0:
        s_plain = min(s_plain, (plain_max - top_source) / d_max)
    # A bowl's cross slope is steeper than its extension, so the field
    # around the notch falls toward the notch and not along it.
    cost = np.where(lk, s_plain, 0.0)
    factor = float(params["s4"]["bowl_cross_factor"])
    for n, line in enumerate(skel.ext.values(), start=1):
        rise = skel.height[line[-1]] - skel.height[skel.parent[line[0]]]
        run = _step(skel.parent[line[0]], line[0]) + sum(
            _step(a, b) for a, b in zip(line, line[1:]))
        cost = np.where(bowls == n, factor * rise / run, cost)
    surface = field_from(source, cost)
    surface[~built] = np.nan
    return surface, fan_src, s_plain, d_max


def build_hydro(mask: np.ndarray, prot: Protection, macro: np.ndarray,
                manifest: dict, geometry: dict, constraints: dict,
                params: dict) -> tuple[Hydro, np.ndarray]:
    """Run S4 and S5 and their gates. `macro` is the coarse upland field
    (S3; flat in M2). Returns the Hydro result and the fine mask, amended by
    the delta-front class rule."""
    hydro, amended = construct_hydro(mask, prot, macro, manifest, geometry,
                                     constraints, params)
    if hydro.report["front_blocks"]["fixed"]:
        # the mask changed after Gate S2 passed it: pass it again
        M.gate_s2_validator(amended, prot.ppu, constraints, manifest, geometry)
    hydro.report["s5"] = gate_s5(hydro, manifest, geometry, constraints, params)
    return hydro, amended


def construct_hydro(mask: np.ndarray, prot: Protection, macro: np.ndarray,
                    manifest: dict, geometry: dict, constraints: dict,
                    params: dict) -> tuple[Hydro, np.ndarray]:
    """S4 and S5 without the validator-judged gates (Gate S4 still runs).
    `build_hydro` is the entry point; this exists so the construction can be
    exercised without the validator's two-minute flood."""
    s5 = params["s5"]
    mask, released, front_counts = front_fix(mask, prot, manifest, constraints, params)
    water_c = coarse_water(mask, prot.ppu)
    front = front_water(water_c, manifest, constraints, params)

    skel = build_skeleton(water_c, front, macro, manifest, constraints, params)
    s4_report = gate_s4(skel, water_c, front, manifest, constraints, params)

    lk, rim, fan = lock_set(skel, water_c, front, macro, manifest, geometry,
                            constraints, params)
    sinks, sink_list = sink_raster(manifest, constraints, params)
    bowls = bowl_raster(skel, water_c, lk, rim, sinks, manifest, constraints, params)
    # cells beside an extension belong to its bowl, not to the plain
    lk &= bowls == 0
    fan &= lk
    if (sinks > 0)[lk | (bowls > 0)].any():
        raise GateError("S4", "a declared sink lies on the plain or in a catchment bowl")

    surface, fan_src, s_plain, d_max = build_surface(skel, lk, fan, bowls, front, params)
    built = lk | (bowls > 0)
    unreached = built & ~np.isfinite(surface)
    if unreached.any():  # S5.5: every non-source cell of Lk was reached
        r, c = np.argwhere(unreached)[0]
        raise GateError("S5", f"{int(unreached.sum())} cells of the lock set are cut "
                              f"off from every source, e.g. ({c},{r})")
    if float(np.nanmin(surface[built])) < float(s5["min_land_m"]) - 1e-9:
        raise GateError("S5", "the constructed surface dips under min_land_m")
    if float(surface[lk].max()) > float(s5["plain_max_m"]) + 1e-9:
        raise GateError("S5", f"max(h on Lk) is over {s5['plain_max_m']} m")

    # S5.6 boundary: outside land that touches the built set stands above it;
    # the shore rim stands wedge_rim_m above the Lk behind it.
    coarse = np.where(water_c, WATER_M, macro).astype(np.float64)
    coarse[built] = surface[built]
    inside = np.where(built, coarse, -np.inf)
    near = ndimage.maximum_filter(inside, size=3, mode="constant", cval=-np.inf)
    outside = ~water_c & ~built
    coarse = np.where(outside & np.isfinite(near),
                      np.maximum(coarse, near + float(s5["divide_margin_m"])), coarse)
    reach = 2 * int(s5["shore_rim_cells"]) + 1
    behind = ndimage.maximum_filter(np.where(lk, coarse, -np.inf), size=reach,
                                    mode="constant", cval=-np.inf)
    coarse = np.where(rim & np.isfinite(behind),
                      np.maximum(coarse, behind + float(params["wedge_rim_m"])), coarse)

    hydro = Hydro(water_c=water_c, front=front, skeleton=skel, lk=lk, rim=rim,
                  bowls=bowls, sinks=sinks, sink_list=sink_list, fan=fan_src,
                  released_water=released,
                  coarse=coarse, s_plain=s_plain, d_max=d_max)
    hydro.report = {
        "front_blocks": front_counts,
        "lk_cells": int(lk.sum()),
        "bowl_cells": {rid: int((bowls == n).sum())
                       for n, rid in enumerate(skel.ext, start=1)},
        "fan_cells": int(fan_src.sum()),
        "fan_cells_demoted": int((fan & ~fan_src).sum()),
        "s_plain_m_per_u": s_plain,
        "d_max_u": d_max,
        "confluence": list(skel.confluence),
        "s4": s4_report,
    }
    return hydro, mask


def coarse_context(coarse: np.ndarray, manifest: dict, geometry: dict,
                   constraints: dict) -> V.Context:
    """A validator context on the coarse field as it will be written
    (float32), at 1 px/unit: `Context.coarse` is then the field itself."""
    elev = coarse.astype(np.float32).astype(np.float64)
    return V.Context(elev=elev, ppu=1, relief=True, sea_level=0.0,
                     constraints=constraints, manifest=manifest, geometry=geometry)


def gate_s5(hydro: Hydro, manifest: dict, geometry: dict, constraints: dict,
            params: dict) -> dict:
    """Gate S5, judged by the validator's own flood and receivers."""
    skel = hydro.skeleton
    ctx = coarse_context(hydro.coarse, manifest, geometry, constraints)
    elev_c, water_c = ctx.coarse
    if not np.array_equal(water_c, hydro.water_c):
        raise GateError("S5", "the coarse field does not pool to the coarse classes")
    built = hydro.built

    # C5a traces every land cell of the floodplain core, so the core must
    # lie inside the lock set. Shore rim cells in the core are reported
    # (none is expected along the wedge).
    outlet = constraints["ndjadi_outlet"]
    core = V._core_mask(ctx, outlet)
    if core is None:
        raise GateError("S5", "the floodplain shape does not resolve")
    core_off_lock = core & ~water_c & ~hydro.lk
    if core_off_lock.any():
        r, c = np.argwhere(core_off_lock)[0]
        raise GateError("S5", f"{int(core_off_lock.sum())} land cells of C5a's core are "
                              f"outside the lock set, e.g. ({c},{r})")
    rim_in_core = int((hydro.rim & core).sum())

    # the pit-free claim, asserted before routing (S5.5)
    lowest = ndimage.minimum_filter(elev_c, size=3, mode="constant", cval=np.inf)
    pits = built & ~(lowest < elev_c)
    if pits.any():
        r, c = np.argwhere(pits)[0]
        raise GateError("S5", f"{int(pits.sum())} built cells have no lower "
                              f"neighbour, e.g. ({c},{r})")

    _filled, _order, depth = ctx.flood
    if float(depth[built].max()) != 0.0:
        raise GateError("S5", f"fill depth on the lock set is "
                              f"{float(depth[built].max()):.3f} m, not zero")

    # Every skeleton cell's lowest neighbour is the next skeleton cell
    # downstream. Inside the neck disk it may be any skeleton cell downstream
    # of it; the trunk's last land cell may take any front-water cell.
    neck_x, neck_y = resolve_point(manifest, outlet["neck"])
    neck_r = float(outlet.get("neck_r_u", 12))
    down = ctx.down.ravel()
    hops = 0
    for cell, expect in skel.parent.items():
        got = int(down[cell])
        if got == expect:
            continue
        r, c = unflat(cell)
        if cell == skel.trunk[-1]:
            ok = got >= 0 and bool(hydro.front.ravel()[got])
        elif math.hypot(c + 0.5 - neck_x, r + 0.5 - neck_y) <= neck_r:
            cur, ok = expect, False
            while cur != skel.root and not ok:
                cur = skel.parent[cur]
                ok = cur == got
        else:
            ok = False
        if not ok:
            raise GateError("S5", f"skeleton cell ({c},{r}) does not drain to the "
                                  f"next skeleton cell downstream")
        hops += 1
    for rid, entry in skel.entries.items():
        trace, terminal = V._trace(entry, ctx.down, water_c)
        if terminal != "water" or not hydro.front.ravel()[trace[-1]]:
            raise GateError("S5", f"river {rid!r}: the trace from its entry ends at "
                                  f"{terminal}, not in Basin water near the outlet port")
        if any(cell not in skel.parent for cell in trace[:-1]):
            raise GateError("S5", f"river {rid!r}: the trace leaves the skeleton")

    results = V.run_checks(ctx, ["C4", "C5"])
    rows = [row for check in results.values() for row in check]
    bad = [row for row in rows
           if row.result != V.PASS and not row.item.startswith("C5b")]
    if bad:
        detail = "; ".join(f"{row.item} {row.result}: {row.detail}" for row in bad[:8])
        raise GateError("S5", f"validator: {detail}")
    return {
        "skeleton_hops": hops,
        "rim_cells_in_c5a_core": rim_in_core,
        "validator": {row.item: [row.result, row.detail] for row in rows},
    }
