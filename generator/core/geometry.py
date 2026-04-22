"""
geometry.py — Voronoi tessellation + C-shape boolean mask

Uses scipy.spatial.Voronoi for cell generation and Shapely for
constraining output to the C-shaped continental outline.

STUB — full implementation pending.
"""


import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
import noise

def generate_voronoi(civ_polygons_dict: dict[str, list[list[float]]], num_points: int = 4000, seed: int = 42) -> list[dict]:
    """
    Generate Voronoi tessellation bounded by the civilization polygons.
    Returns a list of cell dictionaries:
      - 'polygon': list of [x, y] coordinates
      - 'civ': which civilization it primarily falls into
      - 'elevation': computed height value
    """
    rng = np.random.default_rng(seed)
    
    # 1. Create civilization shapely polygons and the master continental mask
    civ_shapes = {}
    for civ_id, coords in civ_polygons_dict.items():
        if len(coords) >= 3:
            poly = Polygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
            civ_shapes[civ_id] = poly
            
    if not civ_shapes:
        return []
        
    continent_mask = unary_union(list(civ_shapes.values()))
    
    # Get bounding box
    minx, miny, maxx, maxy = continent_mask.bounds
    
    # 2. Generate random points
    points = []
    while len(points) < num_points:
        pts = rng.uniform(low=[minx, miny], high=[maxx, maxy], size=(num_points, 2))
        for p in pts:
            if continent_mask.contains(Point(p)):
                points.append(p)
                if len(points) >= num_points:
                    break
    
    points = np.array(points)
    
    # Add dummy points far away to ensure finite regions for boundary cells
    dummy_dist = max(maxx - minx, maxy - miny) * 2
    dummy_points = np.array([
        [minx - dummy_dist, miny - dummy_dist],
        [minx - dummy_dist, maxy + dummy_dist],
        [maxx + dummy_dist, miny - dummy_dist],
        [maxx + dummy_dist, maxy + dummy_dist],
    ])
    all_points = np.vstack([points, dummy_points])
    
    # 3. Compute Voronoi
    vor = Voronoi(all_points)
    
    cells = []
    # Only iterate over the actual points (exclude dummies)
    for i in range(num_points):
        region_idx = vor.point_region[i]
        region = vor.regions[region_idx]
        
        if -1 in region or len(region) == 0:
            continue
            
        cell_coords = [vor.vertices[v] for v in region]
        cell_poly = Polygon(cell_coords)
        
        # Clip to continent mask to keep edges clean
        if not cell_poly.is_valid:
            cell_poly = cell_poly.buffer(0)
            
        clipped_poly = cell_poly.intersection(continent_mask)
        
        if clipped_poly.is_empty:
            continue
            
        # Extract outer coordinates (handle MultiPolygons if needed)
        polys_to_process = [clipped_poly] if isinstance(clipped_poly, Polygon) else list(clipped_poly.geoms)
        
        # Center of the cell for noise/civ assignment
        cx, cy = points[i]
        pt = Point(cx, cy)
        
        # Determine dominant civ
        assigned_civ = "unknown"
        for civ_id, shape in civ_shapes.items():
            if shape.contains(pt):
                assigned_civ = civ_id
                break
                
        # Calculate elevation using Perlin noise
        # Scale determines the frequency of the hills
        scale = 200.0
        base_noise = noise.snoise2(cx / scale, cy / scale, octaves=4, persistence=0.5, lacunarity=2.0, base=seed)
        
        # Map noise (-1 to 1) to an elevation (-500 to 1000)
        base_elev = base_noise * 1000
        
        # Apply civilization biases
        if assigned_civ == "qollari":
            base_elev += 2000  # High mountains
        elif assigned_civ == "ngaru_bon":
            base_elev += 1200  # Plateau
        elif assigned_civ == "kheshkai":
            base_elev += 600   # Steppe
        elif assigned_civ == "irrah":
            base_elev += 400   # Desert dunes/scrub
        elif assigned_civ == "oravan":
            base_elev += 200   # Volcanic islands
        elif assigned_civ == "ndjadi":
            base_elev -= 400   # Delta floodplains
            
        for poly in polys_to_process:
            if not poly.is_empty and isinstance(poly, Polygon):
                coords_list = list(poly.exterior.coords)
                cells.append({
                    "polygon": coords_list,
                    "civ": assigned_civ,
                    "elevation": float(base_elev)
                })
                
    return cells
