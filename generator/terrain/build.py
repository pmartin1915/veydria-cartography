"""Phase 3 build runner (PHASE3-SPEC section 3 and S13).

M1 runs S1 (protection sets) and S2 (land mask), runs their gates, and
writes a flat bundle (spec B: land +100 m, water -50 m, "relief": false)
plus mask.npy and the S1 protection rasters for inspection.

    python -m generator.terrain.build <outdir> [--seed N] [--ppu 4] [--until S2]

A failed gate prints "GATE <name>: ..." and exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

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

STAGES = ("S1", "S2")


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
    write_bundle(outdir, stages["final"], ppu, seed, PARAMS_PATH)
    digest = hashlib.sha256((outdir / "mask.npy").read_bytes()).hexdigest()
    print(f"bundle written to {outdir} (mask.npy sha256 {digest[:16]}...)")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m generator.terrain.build",
        description="Phase 3 terrain build runner (M1: S1+S2).")
    parser.add_argument("outdir", help="output bundle directory")
    parser.add_argument("--seed", type=int, default=None,
                        help="master seed (default: params 'seed')")
    parser.add_argument("--ppu", type=int, default=4, help="px per unit (default 4)")
    parser.add_argument("--until", choices=STAGES, default="S2",
                        help="stop after this stage (default S2)")
    args = parser.parse_args(argv)
    try:
        return run(Path(args.outdir), args.seed, args.ppu, args.until)
    except P.GateError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
