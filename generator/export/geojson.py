"""
geojson.py — Convert veydria-topology.yaml into GeoJSON FeatureCollection

Produces a single GeoJSON file with features for:
- 6 civilization regions (approximate polygons derived from SVG schematic coordinates)
- 6 chokepoints (point features)
- 6 trade/pilgrimage routes (LineString features with styled properties)
- 4 Basin port zones (point features with lore)
- 2 contested sacred sites (point features)
- 6 Irrah oasis cities (point features)
- 10+ named landmarks (mountains, cities, islands, ruins)
- Ndjadi river system (LineString features)
- Aethelian Basin (polygon feature)

Coordinate system: matches the SVG viewBox (0-1200 x 0-800), which maps
to Leaflet CRS.Simple bounds. The frontend inverts Y for standard map orientation.

All spatial coordinates are loaded from data/coordinate-manifest.yaml,
which is the single source of truth for feature positions.
"""

import json
from pathlib import Path
from typing import Any

from ..core.yaml_loader import TopologyData
from ..core.geometry import generate_voronoi
from ..core.coordinate_loader import load_manifest, CoordinateManifest


# Output path
DEFAULT_OUTPUT = Path(__file__).parent.parent.parent / "output" / "veydria-spatial.geojson"


# Default manifest (loaded lazily to avoid import-time I/O)
_manifest: CoordinateManifest | None = None


def _get_manifest() -> CoordinateManifest:
    """Get the cached coordinate manifest, loading if necessary."""
    global _manifest
    if _manifest is None:
        _manifest = load_manifest()
    return _manifest


def _make_feature(
    geometry_type: str,
    coordinates: Any,
    properties: dict[str, Any],
) -> dict[str, Any]:
    """Create a GeoJSON Feature."""
    return {
        "type": "Feature",
        "geometry": {
            "type": geometry_type,
            "coordinates": coordinates,
        },
        "properties": properties,
    }


def _display_name(key: str) -> str:
    """Convert snake_case key to Title Case display name."""
    return key.replace("_", " ").title().replace("Al ", "al-").replace("Of ", "of ")


def export_geojson(data: TopologyData, output_path: Path | str | None = None) -> Path:
    """
    Convert TopologyData into a GeoJSON FeatureCollection and write to disk.

    Args:
        data: Parsed topology data from yaml_loader.
        output_path: Where to write the GeoJSON. Defaults to output/veydria-spatial.geojson.

    Returns:
        Path to the written GeoJSON file.
    """
    output_path = Path(output_path) if output_path else DEFAULT_OUTPUT
    features: list[dict[str, Any]] = []

    manifest = _get_manifest()

    # --- Aethelian Basin (water body) ---
    basin_data = manifest.water.get("aethelian_basin", {})
    if basin_data:
        features.append(_make_feature(
            "Polygon",
            [basin_data.get("polygon", [])],
            {
                "id": "aethelian_basin",
                "name": "Aethelian Basin",
                "category": "water",
                "description": data.basin.get("description", ""),
                "opening": data.basin.get("opening", ""),
                "fill": basin_data.get("fill", "#3a7ca5"),
                "fillOpacity": basin_data.get("fillOpacity", 0.6),
            },
        ))

    # --- Civilization regions ---
    civ_polygons: dict[str, list[list[float]]] = {}
    for civ_key in data.civ_names:
        civ = data.get_civ(civ_key)
        civ_manifest = manifest.get_civ(civ_key)
        polygon = civ_manifest.get("polygon")
        centroid = civ_manifest.get("centroid")
        fill = civ_manifest.get("fill", "#888")
        if polygon:
            civ_polygons[civ_key] = polygon
            features.append(_make_feature(
                "Polygon",
                [polygon],
                {
                    "id": civ_key,
                    "name": _display_name(civ_key),
                    "category": "civilization",
                    "cardinal": civ.get("cardinal", ""),
                    "elevation": civ.get("elevation", ""),
                    "terrain": civ.get("terrain", ""),
                    "basin_access": civ.get("basin_access", ""),
                    "borders": civ.get("borders", []),
                    "fill": fill,
                    "fillOpacity": 0.35,
                    "centroid": centroid,
                },
            ))

    # --- Terrain Cells (Voronoi Heightmap) ---
    terrain_cells = generate_voronoi(civ_polygons, num_points=3000, seed=1915)
    for i, cell in enumerate(terrain_cells):
        features.append(_make_feature(
            "Polygon",
            [cell["polygon"]],
            {
                "id": f"terrain_cell_{i}",
                "name": f"Terrain {i}",
                "category": "terrain_cell",
                "civ": cell["civ"],
                "elevation": cell["elevation"],
            },
        ))

    # --- Chokepoints ---
    for cp_key in data.chokepoint_names:
        cp = data.get_chokepoint(cp_key)
        cp_manifest = manifest.get_chokepoint(cp_key)
        coords = cp_manifest.get("coords")
        if coords:
            features.append(_make_feature(
                "Point",
                coords,
                {
                    "id": cp_key,
                    "name": _display_name(cp_key),
                    "category": "chokepoint",
                    "type": cp.get("type", ""),
                    "connects": cp.get("connects", []),
                    "description": cp.get("description", ""),
                    "strategic_value": cp.get("strategic_value", ""),
                    "marker-color": cp_manifest.get("marker_color", "#f44"),
                    "marker-symbol": cp_manifest.get("marker_symbol", "roadblock"),
                },
            ))

    # --- Port zones ---
    for port_key, port_data in data.port_zones.items():
        port_manifest = manifest.get_port(port_key)
        coords = port_manifest.get("coords")
        if coords:
            features.append(_make_feature(
                "Point",
                coords,
                {
                    "id": port_key,
                    "name": port_data.get("in_world_name", _display_name(port_key)),
                    "category": "port",
                    "etymology": port_data.get("etymology", ""),
                    "real_world_parallel": port_data.get("real_world_parallel", ""),
                    "location": port_data.get("location", ""),
                    "function": port_data.get("function", ""),
                    "marker-color": port_manifest.get("marker_color", "#e8c840"),
                    "marker-symbol": port_manifest.get("marker_symbol", "harbor"),
                },
            ))

    # --- Contested sites ---
    for site_key, site_data in data.contested_sites.items():
        site_manifest = manifest.get_contested_site(site_key)
        coords = site_manifest.get("coords")
        if coords:
            features.append(_make_feature(
                "Point",
                coords,
                {
                    "id": site_key,
                    "name": _display_name(site_key),
                    "category": "contested_site",
                    "location": site_data.get("location", ""),
                    "description": site_data.get("description", ""),
                    "marker-color": site_manifest.get("marker_color", "#adf"),
                    "marker-symbol": site_manifest.get("marker_symbol", "religious-christian"),
                },
            ))

    # --- Trade routes (from YAML + manifest) ---
    yaml_route_ids = set()
    for route_key in data.route_names:
        route = data.get_route(route_key)
        route_manifest = manifest.get_route(route_key)
        path = route_manifest.get("path")
        style = route_manifest.get("style", {})
        if path:
            yaml_route_ids.add(route_key)
            features.append(_make_feature(
                "LineString",
                path,
                {
                    "id": route_key,
                    "name": style.get("label", _display_name(route_key)),
                    "category": "trade_route",
                    "endpoints": route.get("endpoints", []),
                    "path_description": route.get("path", ""),
                    "commodities": route.get("commodities", ""),
                    "bottleneck": route.get("bottleneck", ""),
                    "consequence_if_closed": route.get("consequence_if_closed", ""),
                    "stroke": style.get("color", "#888"),
                    "stroke-width": 2.5,
                    "stroke-dasharray": style.get("dash_array", ""),
                },
            ))

    # --- Extra routes (defined in manifest only, e.g. Scribal Ladder) ---
    for route_key in manifest.route_names:
        if route_key in yaml_route_ids:
            continue
        route_manifest = manifest.get_route(route_key)
        path = route_manifest.get("path")
        style = route_manifest.get("style", {})
        if path:
            features.append(_make_feature(
                "LineString",
                path,
                {
                    "id": route_key,
                    "name": style.get("label", _display_name(route_key)),
                    "category": "trade_route",
                    "stroke": style.get("color", "#888"),
                    "stroke-width": 2.5,
                    "stroke-dasharray": style.get("dash_array", ""),
                },
            ))

    # --- Irrah oases ---
    for oasis_key in manifest.oasis_names:
        oasis_manifest = manifest.get_oasis(oasis_key)
        coords = oasis_manifest.get("coords")
        if coords:
            features.append(_make_feature(
                "Point",
                coords,
                {
                    "id": oasis_key,
                    "name": _display_name(oasis_key),
                    "category": "oasis",
                    "marker-color": oasis_manifest.get("marker_color", "#4a9a3a"),
                    "marker-symbol": oasis_manifest.get("marker_symbol", "garden"),
                },
            ))

    # --- Named landmarks ---
    for lm in manifest.landmarks:
        features.append(_make_feature(
            "Point",
            lm.get("coords"),
            {
                "id": lm.get("id"),
                "name": lm.get("name"),
                "category": "landmark",
                "type": lm.get("type", ""),
                "description": lm.get("description", ""),
                "marker-color": lm.get("marker_color", "#c4a862"),
                "marker-symbol": lm.get("marker_symbol", "star"),
            },
        ))

    # --- Ndjadi river system ---
    for river_key in manifest.river_names:
        river = manifest.get_river(river_key)
        features.append(_make_feature(
            "LineString",
            river.get("path", []),
            {
                "id": river_key,
                "name": river.get("name", _display_name(river_key)),
                "category": "river",
                "description": river.get("description", ""),
                "stroke": "#4a8ab0",
                "stroke-width": 1.5,
                "stroke-opacity": 0.6,
                "stroke-dasharray": "",
            },
        ))

    # --- Assemble FeatureCollection ---
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "veydria-topology.yaml + coordinate-manifest.yaml",
            "generator": "veydria-cartography/generator/export/geojson.py",
            "coordinate_system": "SVG viewBox (1200x800) — use CRS.Simple in Leaflet with Y-inversion",
            "description": "Spatial data for the continent of Veydria. Coordinates from coordinate-manifest.yaml; topology from veydria-topology.yaml.",
        },
        "features": features,
    }

    # Write
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(collection, f, indent=2, ensure_ascii=False)

    return output_path
