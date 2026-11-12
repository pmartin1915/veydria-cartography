"""Canon loaders and ID resolvers shared by the validator and bundle writers.

Implements spec PHASE2-SPEC.md section A: loading the constraints, manifest and
terrain-geometry YAML as UTF-8, resolving manifest point/route IDs and shape
references, building the canon land mask (A1) and rasterising it.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Iterable, Optional, Union

import numpy as np
import yaml
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.ops import unary_union

try:  # shapely >= 2.0
    from shapely import covers_xy as _covers_xy_impl
except ImportError:  # pragma: no cover - older/partial shapely 2.x builds
    import shapely as _shapely

    def _covers_xy_impl(geom, x, y):
        pts = _shapely.points(np.asarray(x), np.asarray(y))
        return np.asarray(_shapely.covers(geom, pts), dtype=bool)


def covers_xy(geom, x, y) -> np.ndarray:
    """Vectorised point-in-geometry test (boundary included)."""
    return np.asarray(_covers_xy_impl(geom, x, y), dtype=bool)

# The schematic frame, in units (spec A/B): x right, y down.
FRAME_W_U = 1200
FRAME_H_U = 800

# Manifest sections that hold points as dicts with a "coords" key.
POINT_DICT_SECTIONS = ("chokepoints", "ports", "contested_sites", "oases", "waystations")
# Manifest section that holds points as a list of dicts with "id" and "coords".
POINT_LIST_SECTIONS = ("landmarks",)

Coord = tuple[float, float]
Polyline = list[Coord]

_SHAPE_REF = re.compile(
    r"^(civilizations|land|water)\.([A-Za-z_][A-Za-z0-9_]*)(?:\.extra_polygons\[(\d+)\])?$"
)

# Repo root: generator/terrain/canon.py -> parents[2].
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"


def load_yaml(path: Union[str, Path]) -> dict:
    """Load a YAML file as UTF-8 (spec A2)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return data or {}


def load_constraints(path: Union[str, Path]) -> dict:
    """Load data/terrain-constraints.yaml (authored, spec A2)."""
    return load_yaml(path)


def load_manifest(path: Union[str, Path]) -> dict:
    """Load data/coordinate-manifest.yaml (generated, spec A1/A2)."""
    return load_yaml(path)


def load_geometry(path: Union[str, Path]) -> dict:
    """Load data/terrain-geometry.yaml (generated, spec A1)."""
    return load_yaml(path)


def sha256_file(path: Union[str, Path]) -> str:
    """SHA-256 of a file, for the bundle's constraints_sha256 field (spec B)."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def resolve_point(manifest: dict, point_id: str) -> Coord:
    """Resolve a manifest point ID to (x, y) schematic units.

    Looks in the dict sections chokepoints, ports, contested_sites, oases and
    waystations (dicts with ``coords``) and in landmarks (a list of dicts with
    ``id`` and ``coords``). Raises KeyError when the ID is absent.
    """
    for section in POINT_DICT_SECTIONS:
        entry = manifest.get(section, {}).get(point_id)
        if entry is not None and "coords" in entry:
            coords = entry["coords"]
            return float(coords[0]), float(coords[1])
    for entry in manifest.get("landmarks", []):
        if entry.get("id") == point_id and "coords" in entry:
            coords = entry["coords"]
            return float(coords[0]), float(coords[1])
    raise KeyError(f"manifest point id {point_id!r} not found")


def resolve_route_parts(manifest: dict, route_id: str) -> list[Polyline]:
    """Resolve a manifest trade route to its list of part polylines.

    A route stores either ``path`` (one part) or ``paths`` (several parts);
    each part is a polyline as a list of [x, y] pairs.
    """
    route = manifest.get("trade_routes", {}).get(route_id)
    if route is None:
        raise KeyError(f"manifest trade route {route_id!r} not found")
    raw: Iterable[Any]
    if "path" in route:
        raw = [route["path"]]
    elif "paths" in route:
        raw = route["paths"]
    else:
        raise KeyError(f"manifest trade route {route_id!r} has neither path nor paths")
    return [[(float(x), float(y)) for x, y in part] for part in raw]


def _to_geometry(value: Any) -> Union[Polygon, MultiPolygon]:
    """Convert a nested coordinate list to a Polygon or MultiPolygon.

    Accepts a single ring [[x, y], ...] or a list of rings.
    """
    first = value[0]
    if isinstance(first[0], (int, float)):
        return Polygon([(float(x), float(y)) for x, y in value])
    return MultiPolygon([Polygon([(float(x), float(y)) for x, y in ring]) for ring in value])


def resolve_shape(manifest: dict, geometry: dict, ref: str) -> Union[Polygon, MultiPolygon]:
    """Resolve a shape reference (spec A2 / C9).

    Supported forms:
    - ``civilizations.<name>``          -> manifest civ main polygon
    - ``civilizations.<name>.extra_polygons[i]`` -> manifest civ extra polygon i
    - ``land.<name>``                   -> terrain-geometry land key
    - ``water.<name>``                  -> manifest water polygon
    """
    match = _SHAPE_REF.match(ref)
    if not match:
        raise KeyError(f"unparseable shape reference {ref!r}")
    section, name, extra_idx = match.group(1), match.group(2), match.group(3)
    if section == "civilizations":
        civ = manifest.get("civilizations", {}).get(name)
        if civ is None:
            raise KeyError(f"manifest civilization {name!r} not found (ref {ref!r})")
        if extra_idx is not None:
            extras = civ.get("extra_polygons", [])
            idx = int(extra_idx)
            if idx >= len(extras):
                raise KeyError(f"manifest civilization {name!r} extra_polygons[{idx}] missing")
            return Polygon([(float(x), float(y)) for x, y in extras[idx]])
        return Polygon([(float(x), float(y)) for x, y in civ["polygon"]])
    if section == "land":
        value = geometry.get("land", {}).get(name)
        if value is None:
            raise KeyError(f"terrain-geometry land key {name!r} not found (ref {ref!r})")
        return _to_geometry(value)
    # water.<name>
    entry = manifest.get("water", {}).get(name)
    if entry is None:
        raise KeyError(f"manifest water key {name!r} not found (ref {ref!r})")
    return Polygon([(float(x), float(y)) for x, y in entry["polygon"]])


def basin_polygon(manifest: dict) -> Polygon:
    """The manifest aethelian_basin polygon (spec C, Basin versus ocean)."""
    return resolve_shape(manifest, {}, "water.aethelian_basin")


def canon_land_geometry(manifest: dict, geometry: dict) -> Union[Polygon, MultiPolygon]:
    """Build the canon land mask geometry (spec A1).

    Union of: manifest civ polygons and extra_polygons (minus oravan, which is
    only a hull), all terrain-geometry ``land.*`` shapes (the two mainland
    shapes and the eight island rings), minus the manifest
    ``water.aethelian_basin`` polygon. Everything else in the frame is ocean.
    """
    parts: list[Union[Polygon, MultiPolygon]] = []
    for name, civ in manifest.get("civilizations", {}).items():
        if name == "oravan":
            continue  # hull only; the islands carry the land (spec A1)
        parts.append(Polygon([(float(x), float(y)) for x, y in civ["polygon"]]))
        for ring in civ.get("extra_polygons", []):
            parts.append(Polygon([(float(x), float(y)) for x, y in ring]))
    for value in geometry.get("land", {}).values():
        parts.append(_to_geometry(value))
    land = unary_union(parts)
    land = land.difference(basin_polygon(manifest))
    return land


def rasterize_mask(
    geom: Union[Polygon, MultiPolygon],
    ppu: int,
    width_u: float = FRAME_W_U,
    height_u: float = FRAME_H_U,
) -> np.ndarray:
    """Rasterise a geometry to a boolean mask (True = inside), shape
    (height_u*ppu, width_u*ppu), at pixel centres ((c+0.5)/ppu, (r+0.5)/ppu).
    """
    rows, cols = int(round(height_u * ppu)), int(round(width_u * ppu))
    xs = (np.arange(cols) + 0.5) / ppu
    ys = (np.arange(rows) + 0.5) / ppu
    xx, yy = np.meshgrid(xs, ys)
    return covers_xy(geom, xx, yy)


def rect_mask(
    ppu: int,
    x_range: Optional[tuple[float, float]],
    y_range: Optional[tuple[float, float]],
    width_u: float,
    height_u: float,
) -> np.ndarray:
    """Pixel-centre mask for a rectangle in unit coordinates (free zones, spec C8c)."""
    rows, cols = int(round(height_u * ppu)), int(round(width_u * ppu))
    xs = (np.arange(cols) + 0.5) / ppu
    ys = (np.arange(rows) + 0.5) / ppu
    xx, yy = np.meshgrid(xs, ys)
    mask = np.ones((rows, cols), dtype=bool)
    if x_range is not None:
        mask &= (xx >= x_range[0]) & (xx <= x_range[1])
    if y_range is not None:
        mask &= (yy >= y_range[0]) & (yy <= y_range[1])
    return mask


def erode_and_clip(
    geom: Union[Polygon, MultiPolygon],
    erode_u: float,
    x_range: Optional[tuple[float, float]] = None,
    y_range: Optional[tuple[float, float]] = None,
) -> Union[Polygon, MultiPolygon]:
    """Erode a shape by erode_u and optionally clip to x/y ranges (spec C9)."""
    out = geom.buffer(-float(erode_u))
    if x_range is not None or y_range is not None:
        clip = box(
            x_range[0] if x_range is not None else -1e9,
            y_range[0] if y_range is not None else -1e9,
            x_range[1] if x_range is not None else 1e9,
            y_range[1] if y_range is not None else 1e9,
        )
        out = out.intersection(clip)
    return out
