"""Write the canon-mask bundle (spec D, canon self-check; mask defined in spec A1).

The bundle is the canon land/water union rasterised at 2 px/unit: land is
+100 m, water is -50 m, and terrain.json declares "relief": false so the
validator skips elevation/relief checks (spec D).

CLI: python -m generator.terrain.canon_mask <outdir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from .canon import (
    DATA_DIR,
    FRAME_H_U,
    FRAME_W_U,
    canon_land_geometry,
    load_geometry,
    load_manifest,
    rasterize_mask,
    sha256_file,
)

PPU = 2
CONSTRAINTS_PATH = DATA_DIR / "terrain-constraints.yaml"


def write_bundle(outdir: Path, manifest: dict, geometry: dict) -> Path:
    """Rasterise the canon land mask at PPU px/unit and write the bundle."""
    land = rasterize_mask(
        canon_land_geometry(manifest, geometry), PPU, FRAME_W_U, FRAME_H_U)
    elevation = np.where(land, 100.0, -50.0).astype(np.float32)
    outdir.mkdir(parents=True, exist_ok=True)
    np.save(outdir / "elevation.npy", elevation)
    meta = {
        "px_per_unit": PPU,
        "width_u": FRAME_W_U,
        "height_u": FRAME_H_U,
        "sea_level_m": 0,
        "elevation": "elevation.npy",
        "seed": 0,
        "generator": "generator.terrain.canon_mask (spec A1/A3)",
        "constraints_sha256": sha256_file(CONSTRAINTS_PATH),
        "relief": False,
    }
    (outdir / "terrain.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return outdir / "terrain.json"


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        print("usage: python -m generator.terrain.canon_mask <outdir>", file=sys.stderr)
        return 2
    manifest = load_manifest(DATA_DIR / "coordinate-manifest.yaml")
    geometry = load_geometry(DATA_DIR / "terrain-geometry.yaml")
    meta_file = write_bundle(Path(argv[0]), manifest, geometry)
    print(f"canon mask bundle written to {meta_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
