"""
yaml_loader.py — Parse and validate veydria-topology.yaml

Loads the spatial source of truth and provides structured access to:
- Civilization positions and borders
- Chokepoints and their connections
- Trade routes with paths and commodities
- Aethelian Basin port zones and contested sites
- Elevation profile and biological barriers
"""

from pathlib import Path
from typing import Any

import yaml


# Default data path relative to this file
DEFAULT_TOPOLOGY_PATH = Path(__file__).parent.parent.parent / "data" / "veydria-topology.yaml"

# Required top-level keys in the topology YAML
REQUIRED_KEYS = [
    "continental_shape",
    "civilization_positions",
    "chokepoints",
    "aethelian_basin",
    "trade_routes",
    "elevation_profile",
]


class TopologyData:
    """Structured access to parsed veydria-topology.yaml."""

    def __init__(self, raw: dict[str, Any]):
        self._raw = raw
        self.continental_shape = raw.get("continental_shape", {})
        self.civilizations = raw.get("civilization_positions", {})
        self.chokepoints = raw.get("chokepoints", {})
        self.basin = raw.get("aethelian_basin", {})
        self.trade_routes = raw.get("trade_routes", {})
        self.elevation_profile = raw.get("elevation_profile", {})
        self.biological_barriers = raw.get("biological_barriers", {})
        self.biomes = raw.get("biomes", {})
        self.relationships = raw.get("relationships", {})

    @property
    def civ_names(self) -> list[str]:
        """Return civilization identifiers."""
        return list(self.civilizations.keys())

    @property
    def chokepoint_names(self) -> list[str]:
        """Return chokepoint identifiers."""
        return list(self.chokepoints.keys())

    @property
    def route_names(self) -> list[str]:
        """Return trade route identifiers."""
        return list(self.trade_routes.keys())

    @property
    def port_zones(self) -> dict[str, Any]:
        """Return Basin functional zones (port cities)."""
        return self.basin.get("functional_zones", {})

    @property
    def contested_sites(self) -> dict[str, Any]:
        """Return Basin contested sacred sites."""
        return self.basin.get("contested_sites", {})

    def get_civ(self, name: str) -> dict[str, Any]:
        """Get a specific civilization's data."""
        return self.civilizations.get(name, {})

    def get_chokepoint(self, name: str) -> dict[str, Any]:
        """Get a specific chokepoint's data."""
        return self.chokepoints.get(name, {})

    def get_route(self, name: str) -> dict[str, Any]:
        """Get a specific trade route's data."""
        return self.trade_routes.get(name, {})

    def get_biome(self, civ_name: str) -> dict[str, Any]:
        """Get a specific civilization's biome data."""
        return self.biomes.get(civ_name, {})


def load_topology(path: Path | str | None = None) -> TopologyData:
    """
    Load and validate veydria-topology.yaml.

    Args:
        path: Path to the YAML file. Defaults to data/veydria-topology.yaml.

    Returns:
        TopologyData with structured access to all spatial data.

    Raises:
        FileNotFoundError: If the YAML file doesn't exist.
        ValueError: If required keys are missing.
    """
    path = Path(path) if path else DEFAULT_TOPOLOGY_PATH

    if not path.exists():
        raise FileNotFoundError(f"Topology YAML not found at: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    if not isinstance(raw, dict):
        raise ValueError(f"Expected dict at top level, got {type(raw).__name__}")

    # Validate required keys
    missing = [k for k in REQUIRED_KEYS if k not in raw]
    if missing:
        raise ValueError(f"Missing required keys in topology YAML: {missing}")

    return TopologyData(raw)


if __name__ == "__main__":
    # Quick self-test
    data = load_topology()
    print(f"Loaded topology with {len(data.civ_names)} civilizations:")
    for name in data.civ_names:
        civ = data.get_civ(name)
        print(f"  {name}: {civ.get('cardinal', '?')} ({civ.get('elevation', '?')})")
    print(f"\n{len(data.chokepoint_names)} chokepoints:")
    for name in data.chokepoint_names:
        cp = data.get_chokepoint(name)
        print(f"  {name}: connects {cp.get('connects', [])}")
    print(f"\n{len(data.route_names)} trade routes:")
    for name in data.route_names:
        rt = data.get_route(name)
        print(f"  {name}: {rt.get('endpoints', [])}")
    print(f"\n{len(data.port_zones)} port zones:")
    for name, zone in data.port_zones.items():
        print(f"  {zone.get('in_world_name', name)}: {zone.get('location', '?')}")
    print(f"\n{len(data.contested_sites)} contested sites:")
    for name, site in data.contested_sites.items():
        print(f"  {name}: {site.get('location', '?')}")
