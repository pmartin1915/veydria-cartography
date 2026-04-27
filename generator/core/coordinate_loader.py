"""
coordinate_loader.py — Load and validate coordinate-manifest.yaml

Provides structured access to all spatial feature positions used in
the GeoJSON export pipeline. This is the bridge between the hand-authored
SVG schematic and the generated map artifacts.
"""

from pathlib import Path
from typing import Any

from .yaml_io import load_rt


DEFAULT_MANIFEST_PATH = Path(__file__).parent.parent.parent / "data" / "coordinate-manifest.yaml"


class CoordinateManifest:
    """Structured access to parsed coordinate-manifest.yaml."""

    def __init__(self, raw: dict[str, Any]):
        self._raw = raw
        self.coordinate_system = raw.get("coordinate_system", {})
        self.civilizations = raw.get("civilizations", {})
        self.water = raw.get("water", {})
        self.chokepoints = raw.get("chokepoints", {})
        self.ports = raw.get("ports", {})
        self.contested_sites = raw.get("contested_sites", {})
        self.oases = raw.get("oases", {})
        self.landmarks = raw.get("landmarks", [])
        self.rivers = raw.get("rivers", {})
        self.trade_routes = raw.get("trade_routes", {})
        self.metadata = raw.get("metadata", {})

    @property
    def civ_names(self) -> list[str]:
        return list(self.civilizations.keys())

    @property
    def chokepoint_names(self) -> list[str]:
        return list(self.chokepoints.keys())

    @property
    def port_names(self) -> list[str]:
        return list(self.ports.keys())

    @property
    def contested_site_names(self) -> list[str]:
        return list(self.contested_sites.keys())

    @property
    def oasis_names(self) -> list[str]:
        return list(self.oases.keys())

    @property
    def river_names(self) -> list[str]:
        return list(self.rivers.keys())

    @property
    def route_names(self) -> list[str]:
        return list(self.trade_routes.keys())

    def get_civ(self, name: str) -> dict[str, Any]:
        return self.civilizations.get(name, {})

    def get_chokepoint(self, name: str) -> dict[str, Any]:
        return self.chokepoints.get(name, {})

    def get_port(self, name: str) -> dict[str, Any]:
        return self.ports.get(name, {})

    def get_contested_site(self, name: str) -> dict[str, Any]:
        return self.contested_sites.get(name, {})

    def get_oasis(self, name: str) -> dict[str, Any]:
        return self.oases.get(name, {})

    def get_river(self, name: str) -> dict[str, Any]:
        return self.rivers.get(name, {})

    def get_route(self, name: str) -> dict[str, Any]:
        return self.trade_routes.get(name, {})

    def get_landmarks_by_type(self, type_name: str) -> list[dict[str, Any]]:
        return [lm for lm in self.landmarks if lm.get("type") == type_name]


def load_manifest(path: Path | str | None = None) -> CoordinateManifest:
    """
    Load and validate coordinate-manifest.yaml.

    Args:
        path: Path to the YAML file. Defaults to data/coordinate-manifest.yaml.

    Returns:
        CoordinateManifest with structured access to all spatial data.
    """
    path = Path(path) if path else DEFAULT_MANIFEST_PATH

    if not path.exists():
        raise FileNotFoundError(f"Coordinate manifest not found at: {path}")

    raw = load_rt(path)

    if not isinstance(raw, dict):
        raise ValueError(f"Expected dict at top level, got {type(raw).__name__}")

    return CoordinateManifest(raw)


if __name__ == "__main__":
    # Quick self-test
    manifest = load_manifest()
    print(f"Loaded coordinate manifest v{manifest.metadata.get('version', '?')}")
    print(f"  Civilizations: {len(manifest.civ_names)}")
    print(f"  Chokepoints: {len(manifest.chokepoint_names)}")
    print(f"  Ports: {len(manifest.port_names)}")
    print(f"  Landmarks: {len(manifest.landmarks)}")
    print(f"  Rivers: {len(manifest.river_names)}")
    print(f"  Trade routes: {len(manifest.route_names)}")
