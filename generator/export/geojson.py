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
"""

import json
from pathlib import Path
from typing import Any

from ..core.yaml_loader import TopologyData


# Output path
DEFAULT_OUTPUT = Path(__file__).parent.parent.parent / "output" / "veydria-spatial.geojson"


# ============================================================
# COORDINATE DATA
# Derived from veydria-schematic.svg (1200x800 viewBox)
# These are approximate centroid/path coordinates for each feature
# ============================================================

# Civilization approximate polygon coordinates (from SVG paths)
CIV_POLYGONS: dict[str, list[list[float]]] = {
    "ngaru_bon": [
        [380, 80], [500, 60], [750, 50], [900, 80],
        [950, 90], [980, 110], [1000, 140],
        [940, 170], [860, 190], [780, 200],
        [680, 220], [560, 210], [460, 200],
        [400, 190], [370, 160], [380, 120], [380, 80],
    ],
    "irrah": [
        [460, 200], [560, 210], [680, 220], [780, 200],
        [860, 190], [940, 170], [1000, 140],
        [1040, 180], [1080, 240], [1100, 300],
        [1080, 350], [1050, 400], [1000, 440],
        [940, 380], [860, 360], [780, 340],
        [680, 310], [560, 300], [460, 290],
        [400, 280], [370, 250], [380, 220],
        [400, 210], [430, 200], [460, 200],
    ],
    "kheshkai": [
        [1000, 140], [1040, 180], [1080, 240], [1100, 300],
        [1110, 340], [1100, 380], [1080, 420],
        [1050, 460], [1000, 490], [950, 510],
        [900, 460], [870, 400], [860, 360],
        [870, 320], [900, 280], [940, 250],
        [960, 220], [980, 180], [1000, 140],
    ],
    "ndjadi": [
        [460, 580], [530, 600], [620, 620], [700, 630],
        [780, 640], [840, 630], [880, 610],
        [920, 590], [950, 560], [960, 530],
        [930, 550], [900, 570], [860, 590],
        [800, 620], [700, 640], [600, 650],
        [520, 660], [450, 650], [400, 630],
        [370, 610], [360, 590], [380, 570],
        [410, 575], [440, 580], [460, 580],
    ],
    "qollari": [
        [340, 330], [330, 370], [310, 410], [300, 450],
        [290, 490], [300, 530], [330, 560],
        [360, 580], [400, 590], [440, 580],
        [430, 560], [420, 520], [400, 480],
        [380, 440], [370, 400], [360, 360],
        [350, 340], [340, 330],
    ],
    "oravan": [
        # Archipelago — approximate bounding ellipse for the island cluster
        [140, 290], [180, 270], [250, 278], [270, 310],
        [270, 380], [250, 430], [220, 455],
        [190, 455], [150, 420], [130, 380],
        [130, 340], [140, 290],
    ],
}

# Civilization centroids (label positions from SVG)
CIV_CENTROIDS: dict[str, list[float]] = {
    "ngaru_bon": [650, 120],
    "irrah": [730, 270],
    "kheshkai": [1010, 340],
    "ndjadi": [680, 610],
    "qollari": [365, 470],
    "oravan": [200, 365],
}

# Civilization colors
CIV_COLORS: dict[str, str] = {
    "ngaru_bon": "#7a6b55",
    "irrah": "#d4a854",
    "kheshkai": "#a8b86a",
    "ndjadi": "#3a8a3a",
    "qollari": "#2d6b3f",
    "oravan": "#4a9a4a",
}

# Chokepoint positions (from SVG)
CHOKEPOINT_COORDS: dict[str, list[float]] = {
    "lam_chen_pass": [940, 168],
    "a_tzalan_ford": [960, 510],
    "smith_spring": [880, 200],
    "breath_of_cloud": [900, 440],
    "qollari_cliff_roads": [370, 520],
    "halkar_straits": [320, 390],
}

# Port zone positions (from SVG)
PORT_COORDS: dict[str, list[float]] = {
    "ki_mbuhari": [650, 620],
    "tavakh_qarat": [600, 290],
    "halani_tamu": [860, 420],
    "dzong_tamu": [830, 560],
}

# Contested site positions (from SVG)
CONTESTED_COORDS: dict[str, list[float]] = {
    "qhabal_ur": [599, 444],
    "veyd_kirrha": [483, 576],
}

# Irrah oasis positions (from SVG + MAP-PROMPT)
OASIS_COORDS: dict[str, list[float]] = {
    "qarat_al_fidda": [730, 260],
    "ghadam_thalla": [590, 240],
    "tin_mashraq": [950, 240],
    "khulut": [680, 320],
    "zin_iferis": [820, 230],
    "ayn_salqat": [780, 290],  # Along Scribal Ladder route
}

# Named landmarks (from MAP-PROMPT and SVG)
LANDMARK_DATA: list[dict[str, Any]] = [
    # Mountains
    {"id": "zang_ri", "name": "Zang-Ri (Copper Mountain)", "coords": [555, 78],
     "category": "landmark", "type": "mountain",
     "description": "Named peak in the Ngaru-Bon plateau. Primary mining site for copper ore."},
    {"id": "apu_yana", "name": "Apu-Yana (Black Mountain)", "coords": [414, 414],
     "category": "landmark", "type": "volcano",
     "description": "Active volcanic peak on the Qollari eastern border, near Kheshkai. Sacred site."},
    {"id": "kha_tepet", "name": "Kha-Tepet (Blood Mountain)", "coords": [1040, 290],
     "category": "landmark", "type": "mountain",
     "description": "Sacred peak on the Kheshkai steppe. Site of ancestral burial kurgans."},
    # Cities & settlements
    {"id": "ki_jenga", "name": "Ki-Jenga", "coords": [720, 580],
     "category": "landmark", "type": "city",
     "description": "Inland Ndjadi city. Site of Mbu-Bwana's famous baray from the Obsidian Blockade."},
    {"id": "hassag_nganin", "name": "Hassag-Nganin (Five-Confluence)", "coords": [700, 540],
     "category": "landmark", "type": "sacred_site",
     "description": "Where the five Ndjadi channels braid together. Contested religious site."},
    {"id": "volata_xal", "name": 'Volata-Xal ("Shipyard in the Dust")', "coords": [978, 530],
     "category": "landmark", "type": "ruin",
     "description": "Abandoned Oravan catamaran settlement near A-Tzalan Ford, from the Obsidian Blockade."},
    {"id": "wasi_puma", "name": 'Wasi-Puma ("House of the Lion")', "coords": [330, 550],
     "category": "landmark", "type": "fortress",
     "description": "Fortified Qollari settlement built during the Obsidian Blockade."},
    # Oravan islands
    {"id": "halkar_port", "name": "Halkar", "coords": [255, 310],
     "category": "landmark", "type": "port_city",
     "description": "Main Oravan port island closest to Halkar Straits. Primary settlement."},
    {"id": "first_caldera", "name": "First Caldera", "coords": [190, 370],
     "category": "landmark", "type": "sacred_site",
     "description": "Seawater-filled volcanic caldera on an inner Oravan island. Major pilgrimage site."},
    {"id": "kelata", "name": "Kelata", "coords": [155, 340],
     "category": "landmark", "type": "resource",
     "description": "Obsidian-source island. Key strategic resource for Oravan naval power."},
]

# Ndjadi river system (from SVG paths)
RIVER_PATHS: list[dict[str, Any]] = [
    {"id": "ndjadi_tributary_north", "name": "Northern Tributary (from Kheshkai)",
     "path": [[960, 510], [900, 520], [820, 530], [700, 530]],
     "description": "Descends from the Kheshkai escarpment through A-Tzalan Ford."},
    {"id": "ndjadi_tributary_west", "name": "Western Tributary (from Qollari)",
     "path": [[440, 480], [500, 500], [600, 520], [700, 530]],
     "description": "Flows from Qollari cloud forest into the delta system."},
    {"id": "ndjadi_dist_1", "name": "First Distributary",
     "path": [[700, 530], [680, 560], [660, 590], [640, 640]],
     "description": "Westernmost channel of the five-distributary fan delta."},
    {"id": "ndjadi_dist_2", "name": "Second Distributary",
     "path": [[700, 530], [710, 565], [700, 600], [680, 640]],
     "description": "Second channel, passing near Ki-Jenga."},
    {"id": "ndjadi_dist_3", "name": "Third Distributary (Central)",
     "path": [[700, 530], [720, 570], [730, 610], [720, 645]],
     "description": "Central channel — the main navigable waterway."},
    {"id": "ndjadi_dist_4", "name": "Fourth Distributary",
     "path": [[700, 530], [740, 570], [760, 610], [760, 645]],
     "description": "Fourth channel, serving the eastern granary districts."},
    {"id": "ndjadi_dist_5", "name": "Fifth Distributary",
     "path": [[700, 530], [750, 560], [790, 600], [800, 635]],
     "description": "Easternmost channel, entering the Basin near Dzong-Tamu."},
]

# Trade route paths (from SVG, simplified waypoints)
ROUTE_PATHS: dict[str, list[list[float]]] = {
    "copper_for_steel_road": [
        [650, 620], [750, 590], [900, 540], [960, 510],
        [970, 470], [960, 350], [950, 280],
        [945, 230], [940, 190], [940, 168], [860, 110],
    ],
    "highland_steppe_corridor": [
        # Leg 1: Ngaru-Bon → Kheshkai
        [860, 110], [900, 140], [940, 160], [940, 168],
        [960, 200], [980, 260], [1000, 320],
        # Leg 2: Kheshkai → Qollari
        [1000, 380], [970, 410], [940, 430], [900, 440],
        [850, 450], [750, 470], [600, 480],
        [500, 490], [430, 490], [400, 480],
    ],
    "highland_relay": [
        [380, 460], [420, 500], [460, 530], [500, 560],
        [540, 580], [600, 600], [650, 620],
    ],
    "coastal_monsoon": [
        [220, 360], [260, 360], [290, 370], [320, 380],
        [360, 390], [420, 400], [500, 410],
        [580, 420], [680, 430], [780, 440],
        [830, 445], [860, 430], [860, 420],
    ],
    "caravan_thread": [
        # Smith-Spring → Qarat al-Fidda
        [880, 200], [840, 230], [790, 250], [730, 260],
        # Qarat al-Fidda → Halani-Tamu
        [730, 260], [770, 300], [820, 360], [860, 420],
    ],
}

# Scribal Ladder pilgrimage (bonus route from MAP-PROMPT)
ROUTE_PATHS["scribal_ladder"] = [
    [650, 620], [680, 560], [720, 500], [780, 460],
    [830, 440], [860, 420],  # Ki-Mbuhari → Halani-Tamu via Basin
    [860, 420], [840, 380], [820, 340], [790, 290],  # Overland into Irrah
    [780, 290], [770, 310], [760, 340],  # To pyramid-necropolises
]

# Trade route styling
ROUTE_STYLES: dict[str, dict[str, str]] = {
    "copper_for_steel_road": {"color": "#8b5e3c", "dashArray": "8,3", "label": "Copper-for-Steel Road"},
    "highland_steppe_corridor": {"color": "#d4a017", "dashArray": "6,4", "label": "Highland-Steppe Corridor"},
    "highland_relay": {"color": "#3a8a3a", "dashArray": "3,5", "label": "Highland Relay"},
    "coastal_monsoon": {"color": "#4a8ab0", "dashArray": "8,2,2,2", "label": "Coastal Monsoon"},
    "caravan_thread": {"color": "#d4a854", "dashArray": "3,4", "label": "Caravan Thread"},
    "scribal_ladder": {"color": "#e05555", "dashArray": "2,5", "label": "Scribal Ladder (pilgrimage)"},
}

# Aethelian Basin polygon (from SVG)
BASIN_POLYGON: list[list[float]] = [
    [340, 330], [360, 310], [400, 290], [460, 280],
    [540, 260], [650, 270], [750, 300],
    [830, 330], [870, 370], [880, 420],
    [890, 480], [860, 540], [800, 580],
    [740, 620], [650, 640], [560, 650],
    [480, 660], [420, 640], [380, 600],
    [340, 560], [310, 500], [300, 450],
    [290, 400], [310, 360], [340, 330],
]


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

    # --- Aethelian Basin (water body) ---
    features.append(_make_feature(
        "Polygon",
        [BASIN_POLYGON],
        {
            "id": "aethelian_basin",
            "name": "Aethelian Basin",
            "category": "water",
            "description": data.basin.get("description", ""),
            "opening": data.basin.get("opening", ""),
            "fill": "#3a7ca5",
            "fillOpacity": 0.6,
        },
    ))

    # --- Civilization regions ---
    for civ_key in data.civ_names:
        civ = data.get_civ(civ_key)
        polygon = CIV_POLYGONS.get(civ_key)
        centroid = CIV_CENTROIDS.get(civ_key)
        if polygon:
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
                    "fill": CIV_COLORS.get(civ_key, "#888"),
                    "fillOpacity": 0.35,
                    "centroid": centroid,
                },
            ))

    # --- Chokepoints ---
    for cp_key in data.chokepoint_names:
        cp = data.get_chokepoint(cp_key)
        coords = CHOKEPOINT_COORDS.get(cp_key)
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
                    "marker-color": "#f44",
                    "marker-symbol": "roadblock",
                },
            ))

    # --- Port zones ---
    for port_key, port_data in data.port_zones.items():
        coords = PORT_COORDS.get(port_key)
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
                    "marker-color": "#e8c840",
                    "marker-symbol": "harbor",
                },
            ))

    # --- Contested sites ---
    for site_key, site_data in data.contested_sites.items():
        coords = CONTESTED_COORDS.get(site_key)
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
                    "marker-color": "#adf",
                    "marker-symbol": "religious-christian",
                },
            ))

    # --- Trade routes (from YAML) ---
    yaml_route_ids = set()
    for route_key in data.route_names:
        route = data.get_route(route_key)
        path = ROUTE_PATHS.get(route_key)
        style = ROUTE_STYLES.get(route_key, {})
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
                    "stroke-dasharray": style.get("dashArray", ""),
                },
            ))

    # --- Extra routes (defined in coordinate data only, e.g. Scribal Ladder) ---
    for route_key, path in ROUTE_PATHS.items():
        if route_key in yaml_route_ids:
            continue
        style = ROUTE_STYLES.get(route_key, {})
        features.append(_make_feature(
            "LineString",
            path,
            {
                "id": route_key,
                "name": style.get("label", _display_name(route_key)),
                "category": "trade_route",
                "stroke": style.get("color", "#888"),
                "stroke-width": 2.5,
                "stroke-dasharray": style.get("dashArray", ""),
            },
        ))

    # --- Irrah oases ---
    for oasis_key, coords in OASIS_COORDS.items():
        features.append(_make_feature(
            "Point",
            coords,
            {
                "id": oasis_key,
                "name": _display_name(oasis_key),
                "category": "oasis",
                "marker-color": "#4a9a3a",
                "marker-symbol": "garden",
            },
        ))

    # --- Named landmarks ---
    for lm in LANDMARK_DATA:
        features.append(_make_feature(
            "Point",
            lm["coords"],
            {
                "id": lm["id"],
                "name": lm["name"],
                "category": "landmark",
                "type": lm.get("type", ""),
                "description": lm.get("description", ""),
                "marker-color": "#c4a862",
                "marker-symbol": "star",
            },
        ))

    # --- Ndjadi river system ---
    for river in RIVER_PATHS:
        features.append(_make_feature(
            "LineString",
            river["path"],
            {
                "id": river["id"],
                "name": river["name"],
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
            "source": "veydria-topology.yaml",
            "generator": "veydria-cartography/generator/export/geojson.py",
            "coordinate_system": "SVG viewBox (1200x800) — use CRS.Simple in Leaflet with Y-inversion",
            "description": "Spatial data for the continent of Veydria. All coordinates derived from veydria-schematic.svg.",
        },
        "features": features,
    }

    # Write
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(collection, f, indent=2, ensure_ascii=False)

    return output_path
