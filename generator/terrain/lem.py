"""S7 coarse erosion (PHASE3-SPEC section S7): the prototype's landscape
evolution core (priority flood, then implicit stream-power incision), with
three changes.

1. Base level is water, the hydro lock, sinks and the frame edge. The flood
   seeds from all of them, and a base cell is never raised or incised.
2. Receivers are the validator's rule everywhere: the lowest neighbour. So
   drainage area carries through the lock exactly as the validator will
   route it, and the uplands grade to the canon rivers.
3. Catchment bowls erode at a fraction of the normal rate (the caller hands
   that in through K).

Determinism: no fastmath, no parallel, stable sorts, float64 throughout.
"""

from __future__ import annotations

import numpy as np
from numba import njit
from scipy import ndimage

DR = np.array([-1, -1, -1, 0, 0, 1, 1, 1], dtype=np.int64)
DC = np.array([-1, 0, 1, -1, 1, -1, 0, 1], dtype=np.int64)
DL = np.array([2.0 ** 0.5, 1.0, 2.0 ** 0.5, 1.0, 1.0, 2.0 ** 0.5, 1.0, 2.0 ** 0.5])


@njit(cache=True)
def priority_flood(h, base, eps):
    """Fill depressions so every cell drains to a base cell. Base cells keep
    their height; every other cell ends at least `eps` above the cell the
    flood reached it from."""
    rows, cols = h.shape
    out = h.copy()
    done = np.zeros((rows, cols), np.bool_)
    cap = rows * cols + 8
    hv = np.empty(cap)
    hi = np.empty(cap, np.int64)
    n = 0
    for r in range(rows):
        for c in range(cols):
            if base[r, c]:
                done[r, c] = True
                hv[n] = out[r, c]
                hi[n] = r * cols + c
                k = n
                n += 1
                while k > 0:
                    p = (k - 1) // 2
                    if hv[p] < hv[k] or (hv[p] == hv[k] and hi[p] <= hi[k]):
                        break
                    hv[p], hv[k] = hv[k], hv[p]
                    hi[p], hi[k] = hi[k], hi[p]
                    k = p
    while n > 0:
        v = hv[0]
        idx = hi[0]
        n -= 1
        hv[0] = hv[n]
        hi[0] = hi[n]
        k = 0
        while True:
            left = 2 * k + 1
            right = left + 1
            s = k
            if left < n and (hv[left] < hv[s] or (hv[left] == hv[s] and hi[left] < hi[s])):
                s = left
            if right < n and (hv[right] < hv[s] or (hv[right] == hv[s] and hi[right] < hi[s])):
                s = right
            if s == k:
                break
            hv[s], hv[k] = hv[k], hv[s]
            hi[s], hi[k] = hi[k], hi[s]
            k = s
        r = idx // cols
        c = idx % cols
        for j in range(8):
            nr = r + DR[j]
            nc = c + DC[j]
            if nr < 0 or nc < 0 or nr >= rows or nc >= cols or done[nr, nc]:
                continue
            done[nr, nc] = True
            if out[nr, nc] <= v + eps:
                out[nr, nc] = v + eps
            hv[n] = out[nr, nc]
            hi[n] = nr * cols + nc
            k = n
            n += 1
            while k > 0:
                p = (k - 1) // 2
                if hv[p] < hv[k] or (hv[p] == hv[k] and hi[p] <= hi[k]):
                    break
                hv[p], hv[k] = hv[k], hv[p]
                hi[p], hi[k] = hi[k], hi[p]
                k = p
    return out


@njit(cache=True)
def receivers(h, terminal):
    """The validator's rule: each cell drains to its lowest neighbour.
    `terminal` cells (water, sinks) drain nowhere. A cell with no lower
    neighbour is its own receiver."""
    rows, cols = h.shape
    rec = np.arange(rows * cols)
    dist = np.ones(rows * cols)
    for r in range(rows):
        for c in range(cols):
            if terminal[r, c]:
                continue
            best = h[r, c]
            bj = -1
            for j in range(8):
                nr = r + DR[j]
                nc = c + DC[j]
                if nr < 0 or nc < 0 or nr >= rows or nc >= cols:
                    continue
                if h[nr, nc] < best:
                    best = h[nr, nc]
                    bj = j
            if bj >= 0:
                rec[r * cols + c] = (r + DR[bj]) * cols + c + DC[bj]
                dist[r * cols + c] = DL[bj]
    return rec, dist


@njit(cache=True)
def accumulate(order, rec, cell_area):
    """Drainage area per cell (m2), highest cells first."""
    area = np.full(order.size, cell_area)
    for j in range(order.size - 1, -1, -1):
        i = order[j]
        r = rec[i]
        if r != i:
            area[r] += area[i]
    return area


@njit(cache=True)
def incise(hf, order, rec, dist, area, k, fixed, m, dt, cell):
    """Implicit stream-power incision (Braun and Willett), lowest cells
    first, so each cell sees its receiver's new height."""
    for j in range(order.size):
        i = order[j]
        r = rec[i]
        if r == i or fixed[i] or k[i] <= 0.0:
            continue
        f = k[i] * dt * area[i] ** m / (dist[i] * cell)
        hf[i] = (hf[i] + f * hf[r]) / (1.0 + f)


def drainage_area(h: np.ndarray, terminal: np.ndarray, cell_m: float) -> np.ndarray:
    """Drainage area (m2) on a surface by the lowest-neighbour rule."""
    rec, _dist = receivers(h, terminal)
    order = np.argsort(h.ravel(), kind="stable")
    return accumulate(order, rec, cell_m * cell_m).reshape(h.shape)


def evolve(h: np.ndarray, base: np.ndarray, terminal: np.ndarray, k: np.ndarray,
           steps: int, dt: float, cell_m: float, m: float, diffusion: float,
           eps: float, hold=None) -> tuple[np.ndarray, np.ndarray]:
    """Run `steps` rounds of flood, route, incise and diffuse.

    `base` cells are base level and never move. `terminal` cells (a subset:
    water and sinks) pass no flow on. `hold` cells never move either, but
    they are not base level: the flood does not seed from them. Returns
    (surface, drainage area in m2 from the last round).
    """
    h = h.astype(np.float64).copy()
    held = h.copy()
    still = base if hold is None else base | hold
    free = ~still
    area = np.zeros(h.shape)
    for _ in range(int(steps)):
        h = priority_flood(h, base, eps)
        rec, dist = receivers(h, terminal)
        flat = h.ravel().copy()
        order = np.argsort(flat, kind="stable")
        a = accumulate(order, rec, cell_m * cell_m)
        incise(flat, order, rec, dist, a, k.ravel(), still.ravel(), m, dt, cell_m)
        h = flat.reshape(h.shape)
        area = a.reshape(h.shape)
        if diffusion > 0:
            # land only: the sea floor must not drag the coast down
            total = ndimage.uniform_filter(np.where(terminal, 0.0, h), 3, mode="nearest")
            count = ndimage.uniform_filter((~terminal).astype(np.float64), 3, mode="nearest")
            mean = total / np.maximum(count, 1e-9)
            h = np.where(free, h + diffusion * (mean - h), h)
        h = np.where(still, held, h)
    return h, area


# ---------------------------------------------------------------------------
# S7: the coarse stage and its gate
# ---------------------------------------------------------------------------

def erode_coarse(hydro, pv, rain, manifest, constraints, params, seed,
                 bowl_erodibility=None):
    """S7 on the composed coarse field. Returns (coarse field, drainage
    area in m2, the anchor stamps re-applied after erosion).

    `bowl_erodibility` overrides the bowls' share of K (Gate S7 sets it to
    zero for its one retry).
    """
    from . import climate as C
    from . import provinces as PV
    from .hydro import BOX3, SHAPE

    s5, s7 = params["s5"], params["s7"]
    spec = params["lem_coarse"]
    water = hydro.water_c
    sink = hydro.sinks > 0
    edge = np.zeros(SHAPE, dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    fixed = water | hydro.lk | sink | hydro.rim
    base = fixed | edge
    terminal = water | sink
    k = C.erodibility(rain, pv, base, hydro.bowls, params, seed, float(spec["k0"]))
    if bowl_erodibility is not None:
        k = np.where(hydro.bowls > 0, k / float(params["s6"]["bowl_erodibility"])
                     * float(bowl_erodibility), k)
    # The mouth of a notch stands beside plain that is lower than the river
    # it feeds. If the mouth eroded, the plain would capture the notch and
    # the entry would lose its catchment, so the mouth is held.
    mouth = (hydro.bowls > 0) & ndimage.binary_dilation(
        hydro.lk, structure=BOX3, iterations=int(s7["mouth_hold_cells"]))
    mouth = ndimage.binary_dilation(mouth, structure=BOX3) & ~water  # and the walls beside it
    cell_m = float(constraints.get("meta", {}).get("km_per_unit", 4)) * 1000.0
    h, area = evolve(hydro.coarse, base, terminal, k, int(spec["steps"]), float(spec["dt"]),
                     cell_m, float(s7["m"]), float(s7["diffusion"]), float(s7["flood_eps_m"]),
                     hold=mouth | pv.lock_exempt)  # an authored cone keeps its height too

    # After erosion: the anchor stamps, the caps and floors (spec S7), the
    # S5.6 boundary again, then one more flood without incision.
    held = base | (hydro.bowls > 0) | pv.lock_exempt
    h, stamps = PV.apply_anchors(h, manifest, constraints, params, frozen=held)
    h = PV.apply_caps_floors(h, pv.cap, pv.floor, skip=held)
    built = hydro.built
    near = ndimage.maximum_filter(np.where(built, h, -np.inf), size=3,
                                  mode="constant", cval=-np.inf)
    # only ground that erosion was free to move is repaired: the rim, the
    # frame edge and the cone were set above the lock in S5 and have not moved
    outside = ~base & ~built & ~pv.lock_exempt
    h = np.where(outside & np.isfinite(near),
                 np.maximum(h, near + float(s5["divide_margin_m"])), h)
    # the cone is a seed of the last flood, so the flood cannot lift its skirt
    h = priority_flood(h, base | pv.lock_exempt, float(s7["flood_eps_m"]))
    h = np.where(water, hydro.coarse, h)
    area = drainage_area(h, terminal, cell_m)  # on the field as it leaves the stage
    return h, area, stamps


class EntryAreaError(Exception):
    """Gate S7: a canon river's entry collects too little area."""


def gate_s7(coarse, hydro, manifest, geometry, constraints, params):
    """Gate S7, judged by the validator on the coarse field: C2, C4, C5,
    C6 and C9 pass (C5b waits for S9), the lock still stands, and the
    validator's own accumulated area at each entry cell is at least
    `entry_area_margin` times entry_min_area_km2."""
    from . import validate as V
    from .hydro import coarse_context
    from .protect import GateError

    ctx = coarse_context(coarse, manifest, geometry, constraints)
    elev_c, water_c = ctx.coarse
    if not np.array_equal(water_c, hydro.water_c):
        raise GateError("S7", "the coarse field does not pool to the coarse classes")
    was = hydro.coarse.astype(np.float32)
    now = coarse.astype(np.float32)
    held = {"the hydro lock": hydro.lk, "the shore rim": hydro.rim,
            "a sink": hydro.sinks > 0, "the water": hydro.water_c}
    if hydro.lock_exempt is not None:
        held["an authored cone"] = hydro.lock_exempt
    for name, cells in held.items():
        if not np.array_equal(now[cells], was[cells]):
            raise GateError("S7", f"erosion moved a cell of {name}")

    margin = float(params["s4"]["entry_area_margin"])
    acc = ctx.acc.ravel()
    areas = {}
    short = []
    for rid, entry in constraints.get("rivers", {}).items():
        need = entry.get("entry_min_area_km2")
        if need is None or rid not in hydro.skeleton.entries:
            continue
        got = float(acc[hydro.skeleton.entries[rid]])
        areas[rid] = got
        if got < margin * float(need):
            short.append(f"{rid}: {got:.0f} km2 at the entry, under {margin:g} x {need}")
    if short:
        raise EntryAreaError("; ".join(short))

    results = V.run_checks(ctx, ["C2", "C4", "C5", "C6", "C9"])
    rows = [row for check in results.values() for row in check]
    bad = [row for row in rows if row.result != V.PASS and not row.item.startswith("C5b")]
    if bad:
        detail = "; ".join(f"{row.item} {row.result}: {row.detail}" for row in bad[:10])
        raise GateError("S7", f"validator: {detail}")
    return {"entry_area_km2": areas,
            "validator": {row.item: [row.result, row.detail] for row in rows}}
