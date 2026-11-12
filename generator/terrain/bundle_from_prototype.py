"""Wrap the prototype's elev.npy (2 px/unit, float, sea negative) as a bundle (spec D).

CLI: python -m generator.terrain.bundle_from_prototype <elev.npy> <outdir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from .canon import DATA_DIR, sha256_file

PPU = 2
CONSTRAINTS_PATH = DATA_DIR / "terrain-constraints.yaml"


def write_bundle(elev_path: Path, outdir: Path) -> Path:
    """Copy elev.npy into a bundle directory and write terrain.json."""
    elev = np.load(elev_path)
    if elev.ndim != 2:
        raise ValueError(f"expected a 2-D elevation array, got shape {elev.shape}")
    elev = np.asarray(elev, dtype=np.float32)
    if not np.isfinite(elev).all():
        raise ValueError("elevation contains non-finite values")
    rows, cols = elev.shape
    if rows % PPU or cols % PPU:
        raise ValueError(f"shape {elev.shape} not divisible by ppu {PPU}")
    outdir.mkdir(parents=True, exist_ok=True)
    np.save(outdir / "elevation.npy", elev)
    meta = {
        "px_per_unit": PPU,
        "width_u": cols // PPU,
        "height_u": rows // PPU,
        "sea_level_m": 0,
        "elevation": "elevation.npy",
        "seed": 0,
        "generator": f"generator.terrain.bundle_from_prototype ({elev_path.name})",
        "constraints_sha256": (sha256_file(CONSTRAINTS_PATH)
                               if CONSTRAINTS_PATH.is_file() else ""),
        "relief": True,
    }
    (outdir / "terrain.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return outdir / "terrain.json"


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 2:
        print("usage: python -m generator.terrain.bundle_from_prototype "
              "<elev.npy> <outdir>", file=sys.stderr)
        return 2
    try:
        meta_file = write_bundle(Path(argv[0]), Path(argv[1]))
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"prototype bundle written to {meta_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
