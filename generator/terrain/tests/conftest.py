"""Shared real-data fixtures for the Phase 3 tests.

S1 does not depend on the seed and costs most of a minute at 2 px/unit, so
one result serves every module in the session.
"""

from __future__ import annotations

import pytest

from generator.terrain import protect as P
from generator.terrain.canon import (
    DATA_DIR,
    load_constraints,
    load_geometry,
    load_manifest,
)
from generator.terrain.params import load_params

PPU = 2


@pytest.fixture(scope="session")
def canon():
    return {
        "manifest": load_manifest(DATA_DIR / "coordinate-manifest.yaml"),
        "geometry": load_geometry(DATA_DIR / "terrain-geometry.yaml"),
        "constraints": load_constraints(DATA_DIR / "terrain-constraints.yaml"),
        "params": load_params(),
    }


@pytest.fixture(scope="session")
def prot(canon):
    return P.build_protection(canon["manifest"], canon["geometry"],
                              canon["constraints"], canon["params"], PPU)
