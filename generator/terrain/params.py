"""Load `data/terrain-params.yaml` (PHASE3-SPEC section 3/6).

The params file holds every tunable number in the terrain pipeline and no
coordinates. This module is a thin, typed loader: values are plain floats and
ints, and a missing key is a loud error (no silent defaults that drift away
from the authored file).
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from .canon import DATA_DIR, load_yaml

PARAMS_PATH = DATA_DIR / "terrain-params.yaml"


def load_params(path: Union[str, Path, None] = None) -> dict:
    """Load the terrain params YAML (authored, spec section 6)."""
    return load_yaml(path or PARAMS_PATH)


def f(params: dict, section: str, key: str) -> float:
    """A required float from a params section; missing keys raise KeyError."""
    return float(params[section][key])


def i(params: dict, section: str, key: str) -> int:
    """A required int from a params section; missing keys raise KeyError."""
    return int(params[section][key])
