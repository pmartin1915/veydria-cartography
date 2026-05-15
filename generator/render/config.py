"""
render/config.py — Layer configuration for static parchment renders.

The web frontend exports a JSON config of visible layers; the Python
pipeline reads it to filter which GeoJSON categories are drawn.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RenderConfig:
    version: int
    generated_at: str
    layers: dict[str, bool]

    # Categories the Python renderer actually supports
    RENDERABLE_CATEGORIES: set[str] = frozenset({
        "terrain_cell",
        "civilization",
        "water",
        "chokepoint",
        "port",
        "oasis",
        "contested_site",
        "trade_route",
        "landmark",
        "river",
    })

    def is_visible(self, category: str) -> bool:
        """Return True if the given category should be rendered."""
        if category not in self.RENDERABLE_CATEGORIES:
            return False
        return self.layers.get(category, True)


def load_render_config(path: Path | str) -> RenderConfig:
    """Load a render config from JSON."""
    path = Path(path)
    with open(path, "r", encoding="utf-8") as f:
        raw: dict[str, Any] = json.load(f)

    version = raw.get("version", 1)
    generated_at = raw.get("generatedAt", "")
    layers = raw.get("layers", {})

    if not isinstance(layers, dict):
        raise ValueError(f"Invalid 'layers' in render config: expected dict, got {type(layers).__name__}")

    # Normalize to bools
    normalized = {k: bool(v) for k, v in layers.items()}

    return RenderConfig(
        version=version,
        generated_at=generated_at,
        layers=normalized,
    )
