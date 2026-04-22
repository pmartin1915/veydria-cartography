"""
azgaar.py — Export Voronoi elevation data to an Azgaar-compatible grayscale heightmap PNG.
"""

import matplotlib
matplotlib.use('Agg')

import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.collections import PatchCollection
import numpy as np
from pathlib import Path
import sys

# Constants matching rasterize.py
SVG_WIDTH = 1200
SVG_HEIGHT = 800

def _get_elevation_color(elevation: float, min_elev: float, max_elev: float) -> str:
    """Map elevation to a grayscale string ('0.0' to '1.0')."""
    # Clamp elevation
    elev = max(min_elev, min(elevation, max_elev))
    # Normalize to 0.1 - 1.0 (avoid 0.0 which is ocean/black)
    normalized = 0.1 + 0.9 * ((elev - min_elev) / (max_elev - min_elev))
    return str(normalized)

def export_azgaar_heightmap(data, output_path: Path, dpi: int = 200) -> None:
    """
    Generate the heightmap PNG.
    We import generate_voronoi here to avoid circular imports if any, 
    and to compute the cells dynamically.
    """
    # Import here to avoid circular dependencies
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from generator.core.geometry import generate_voronoi
    from generator.export.geojson import CIV_POLYGONS
    
    print("Generating Voronoi cells for heightmap...")
    cells = generate_voronoi(CIV_POLYGONS, num_points=8000, seed=1915)
    print(f"Generated {len(cells)} cells.")

    fig_width = 16
    fig_height = fig_width * SVG_HEIGHT / SVG_WIDTH
    fig, ax = plt.subplots(figsize=(fig_width, fig_height), dpi=dpi)

    # Set background to black (Ocean)
    ax.set_facecolor('black')
    fig.patch.set_facecolor('black')

    # Find min and max elevation for normalization
    elevations = [cell['elevation'] for cell in cells]
    if not elevations:
        print("No cells generated, cannot export heightmap.")
        return
        
    min_elev = min(elevations)
    max_elev = max(elevations)
    print(f"Elevation range: {min_elev:.1f} to {max_elev:.1f}")

    patches = []
    colors = []

    for cell in cells:
        coords = cell['polygon']
        # Invert Y coordinate since SVG is top-left origin but Matplotlib is bottom-left
        mpl_coords = [[x, SVG_HEIGHT - y] for x, y in coords]
        
        poly = MplPolygon(mpl_coords, closed=True)
        patches.append(poly)
        
        # Calculate grayscale color
        gray = _get_elevation_color(cell['elevation'], min_elev, max_elev)
        colors.append(gray)

    # Create patch collection
    p = PatchCollection(patches, facecolors=colors, edgecolors='none')
    ax.add_collection(p)

    # Set plot limits
    ax.set_xlim(0, SVG_WIDTH)
    ax.set_ylim(0, SVG_HEIGHT)

    # Remove all margins and axes
    ax.set_position([0, 0, 1, 1])
    ax.set_axis_off()

    # Save to file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, facecolor='black', edgecolor='none', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    print(f"Azgaar heightmap saved to {output_path}")

