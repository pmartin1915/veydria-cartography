"""Phase 3 build runner (PHASE3-SPEC section 3 and S13).

M1 runs S1 (protection sets) and S2 (land mask), runs their gates, and
writes a flat bundle (spec B: land +100 m, water -50 m, "relief": false)
plus mask.npy and the S1 protection rasters for inspection.

M2 adds S4 (hydro skeleton) and S5 (floodplain surface and the hydro lock)
on a flat upland, and writes the coarse field as its own 1 px/unit bundle in
<outdir>/coarse/ so the validator can be pointed straight at it:

    python -m generator.terrain.validate <outdir>/coarse --checks C4,C5

    python -m generator.terrain.build <outdir> [--seed N] [--ppu 4] [--until S5]

A failed gate prints "GATE <name>: ..." and exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

from . import hydro as H
from . import mask as M
from . import protect as P
from .canon import (
    DATA_DIR,
    FRAME_H_U,
    FRAME_W_U,
    load_geometry,
    load_manifest,
    load_constraints,
    sha256_file,
)
from .params import PARAMS_PATH, load_params

CONSTRAINTS_PATH = DATA_DIR / "terrain-constraints.yaml"

STAGES = ("S1", "S2", "S5")  # S4 and S5 build one surface and stop together


def write_bundle(outdir: Path, final_mask: np.ndarray, ppu: int, seed: int,
                 params_path: Path) -> None:
    """Write the flat M1 bundle (PHASE2-SPEC section B) plus mask.npy."""
    outdir.mkdir(parents=True, exist_ok=True)
    elevation = M.flat_elevation(final_mask)
    np.save(outdir / "elevation.npy", elevation)
    np.save(outdir / "mask.npy", final_mask)
    meta = {
        "px_per_unit": int(ppu),
        "width_u": FRAME_W_U,
        "height_u": FRAME_H_U,
        "sea_level_m": 0,
        "elevation": "elevation.npy",
        "seed": int(seed),
        "generator": "generator.terrain.build",
        "constraints_sha256": sha256_file(CONSTRAINTS_PATH),
        "params_sha256": sha256_file(params_path),
        "relief": False,
        "content_sha256": sha256_file(outdir / "elevation.npy"),
    }
    (outdir / "terrain.json").write_text(json.dumps(meta, indent=2),
                                         encoding="utf-8")


def write_coarse(outdir: Path, hydro: "H.Hydro", seed: int, params_path: Path) -> None:
    """Write the S5 coarse field as a 1 px/unit relief bundle, with the
    lock rasters and the gate report beside it."""
    outdir.mkdir(parents=True, exist_ok=True)
    np.save(outdir / "elevation.npy", hydro.coarse.astype(np.float32))
    np.save(outdir / "lk.npy", hydro.lk)
    np.save(outdir / "rim.npy", hydro.rim)
    np.save(outdir / "bowls.npy", hydro.bowls)
    np.save(outdir / "sinks.npy", hydro.sinks)
    skel = hydro.skeleton
    down = np.full(H.SHAPE, -1, dtype=np.int64)  # -1: not a skeleton cell
    for cell, target in skel.parent.items():
        down.ravel()[cell] = target
    np.save(outdir / "skeleton_down.npy", down)
    meta = {
        "px_per_unit": 1,
        "width_u": FRAME_W_U,
        "height_u": FRAME_H_U,
        "sea_level_m": 0,
        "elevation": "elevation.npy",
        "seed": int(seed),
        "generator": "generator.terrain.build (S5 coarse field, flat upland)",
        "constraints_sha256": sha256_file(CONSTRAINTS_PATH),
        "params_sha256": sha256_file(params_path),
        "relief": True,
        "content_sha256": sha256_file(outdir / "elevation.npy"),
        "sinks": hydro.sink_list,
    }
    (outdir / "terrain.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (outdir / "hydro.json").write_text(json.dumps(hydro.report, indent=2),
                                       encoding="utf-8")


def run(outdir: Path, seed: int, ppu: int, until: str) -> int:
    params = load_params()
    if seed is None:
        seed = int(params.get("seed", 1))
    manifest = load_manifest(DATA_DIR / "coordinate-manifest.yaml")
    geometry = load_geometry(DATA_DIR / "terrain-geometry.yaml")
    constraints = load_constraints(CONSTRAINTS_PATH)

    print(f"== S1 (protection sets) ppu={ppu} ==")
    prot = P.build_protection(manifest, geometry, constraints, params, ppu)
    print(f"P_land {int(prot.p_land.sum())} px, P_water {int(prot.p_water.sum())} px")
    outdir.mkdir(parents=True, exist_ok=True)
    np.save(outdir / "p_land.npy", prot.p_land)
    np.save(outdir / "p_water.npy", prot.p_water)
    if until == "S1":
        print("stopping after S1 (--until S1)")
        return 0

    print("== S2 (land mask) ==")
    stages = M.build_mask(prot, manifest, geometry, constraints, params, seed)
    np.save(outdir / "base_mask.npy", stages["base"])
    if until == "S2":
        write_bundle(outdir, stages["final"], ppu, seed, PARAMS_PATH)
        digest = hashlib.sha256((outdir / "mask.npy").read_bytes()).hexdigest()
        print(f"bundle written to {outdir} (mask.npy sha256 {digest[:16]}...)")
        return 0

    print("== S4 (hydro skeleton) and S5 (floodplain surface) ==")
    # shortcut: the upland is one flat height until S3 (provinces) exists; M3 replaces this line.
    macro = np.full(H.SHAPE, float(params["m2_flat_upland_m"]))
    hydro, final = H.build_hydro(stages["final"], prot, macro, manifest,
                                 geometry, constraints, params)
    np.save(outdir / "p_water.npy", prot.p_water & ~hydro.released_water)
    write_bundle(outdir, final, ppu, seed, PARAMS_PATH)
    write_coarse(outdir / "coarse", hydro, seed, PARAMS_PATH)
    report = hydro.report
    print(f"Lk {report['lk_cells']} cells, skeleton {report['s4']['skeleton_cells']} cells, "
          f"s_plain {report['s_plain_m_per_u']:.4f} m/u over D {report['d_max_u']:.0f} u, "
          f"front blocks {report['front_blocks']}")
    for item, (result, detail) in report["s5"]["validator"].items():
        print(f"  {item:36s} {result}  {detail}")
    digest = sha256_file(outdir / "coarse" / "elevation.npy")
    print(f"bundle written to {outdir}; coarse field in {outdir / 'coarse'} "
          f"(elevation.npy sha256 {digest[:16]}...)")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m generator.terrain.build",
        description="Phase 3 terrain build runner (M1: S1+S2; M2: S4+S5).")
    parser.add_argument("outdir", help="output bundle directory")
    parser.add_argument("--seed", type=int, default=None,
                        help="master seed (default: params 'seed')")
    parser.add_argument("--ppu", type=int, default=4, help="px per unit (default 4)")
    parser.add_argument("--until", choices=STAGES, default="S5",
                        help="stop after this stage (default S5)")
    args = parser.parse_args(argv)
    try:
        return run(Path(args.outdir), args.seed, args.ppu, args.until)
    except P.GateError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
