"""
rasterize.py — matplotlib → parchment-style static map PNG

Renders the Veydria continental map as a high-resolution static image
with a hand-drawn fantasy aesthetic:

- Aged parchment background with noise texture
- Civilization regions as watercolor-style fills
- Aethelian Basin as a translucent water body
- Trade routes with dashed styling
- Rivers in blue
- Labeled chokepoints, ports, oases, landmarks
- Compass rose and scale bar
- Title cartouche with ornamental framing

Reads directly from the GeoJSON export (coordinates in SVG viewBox space).
"""

import json
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
from matplotlib.path import Path as MplPath
import matplotlib.patheffects as pe
import numpy as np


# --- CONSTANTS ---
SVG_WIDTH = 1200
SVG_HEIGHT = 800
DPI = 200
FIG_WIDTH = 16  # inches
FIG_HEIGHT = FIG_WIDTH * SVG_HEIGHT / SVG_WIDTH

DEFAULT_GEOJSON = Path(__file__).parent.parent.parent / "output" / "veydria-spatial.geojson"
DEFAULT_OUTPUT = Path(__file__).parent.parent.parent / "output" / "veydria-map.png"

# Color palette — parchment aesthetic
PARCHMENT_BG = '#f5e6c8'
PARCHMENT_DARK = '#e8d5a8'
OCEAN_COLOR = '#b8cfe0'
BASIN_COLOR = '#7ab0c9'
BORDER_COLOR = '#8b7355'
TEXT_COLOR = '#3d2b1f'
TEXT_MUTED = '#6b5b4a'
WATER_TEXT = '#2a5f7a'

# Hypsometric tinting — custom elevation palette
ELEVATION_COLORS = [
    (0.00, '#8ab87a'),   # ndjadi green (low)
    (0.25, '#a8c880'),   # low-mid green
    (0.40, '#c8d4a0'),   # kheshkai green-yellow
    (0.55, '#d8c890'),   # mid yellow-brown
    (0.70, '#c9b896'),   # ngaru-bon plateau
    (0.85, '#a09888'),   # high gray-brown
    (0.95, '#e8e8e8'),   # white peaks
]

# Civilization fill colors (muted, watercolor-like)
CIV_FILLS: dict[str, str] = {
    'ngaru_bon': '#c9b896',
    'irrah': '#e8d5a0',
    'kheshkai': '#c8d4a0',
    'ndjadi': '#8ab87a',
    'qollari': '#7aaa6a',
    'oravan': '#90c490',
}

# Region label position overrides (for when centroids collide with point markers)
# Values in SVG coordinates (pre-Y-inversion)
CIV_LABEL_OVERRIDES: dict[str, list[float]] = {
    'irrah': [800, 220],  # Move up-right away from oasis cluster
}

# Trade route colors
ROUTE_COLORS: dict[str, str] = {
    'copper_for_steel_road': '#7a4a2a',
    'highland_steppe_corridor': '#9a7a30',
    'highland_relay': '#4a7a4a',
    'coastal_monsoon': '#4a7aa0',
    'caravan_thread': '#9a7a40',
    'scribal_ladder': '#a04040',
}

# Route dash patterns (on, off)
ROUTE_DASHES: dict[str, tuple[float, ...]] = {
    'copper_for_steel_road': (8, 3),
    'highland_steppe_corridor': (6, 4),
    'highland_relay': (3, 5),
    'coastal_monsoon': (8, 2, 2, 2),
    'caravan_thread': (3, 4),
    'scribal_ladder': (2, 5),
}

# Marker shapes for categories
MARKER_CONFIG: dict[str, dict[str, Any]] = {
    'port': {'marker': 'D', 'color': '#8b6914', 'size': 50, 'edgecolor': '#5a4510', 'zorder': 15},
    'chokepoint': {'marker': 's', 'color': '#a03030', 'size': 40, 'edgecolor': '#702020', 'zorder': 14},
    'oasis': {'marker': 'o', 'color': '#4a8a3a', 'size': 35, 'edgecolor': '#2a6a2a', 'zorder': 13},
    'contested_site': {'marker': '*', 'color': '#5a8aaa', 'size': 80, 'edgecolor': '#3a6a8a', 'zorder': 14},
    'landmark': {'marker': '^', 'color': '#8b7355', 'size': 25, 'edgecolor': '#6b5335', 'zorder': 12},
}


def _load_geojson(path: Path) -> dict[str, Any]:
    """Load GeoJSON FeatureCollection."""
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _add_parchment_texture(ax: plt.Axes, rng: np.random.Generator) -> None:
    """Add subtle noise texture, vignette, and fold lines to simulate aged parchment."""
    # Base parchment
    ax.set_facecolor(PARCHMENT_BG)

    # Noise overlay
    noise = rng.normal(0, 0.015, (80, 120))
    ax.imshow(
        noise,
        extent=[0, SVG_WIDTH, 0, SVG_HEIGHT],
        cmap='YlOrBr',
        alpha=0.08,
        aspect='auto',
        interpolation='bilinear',
        zorder=0,
    )

    # Subtle vignette
    x = np.linspace(-1, 1, 120)
    y = np.linspace(-1, 1, 80)
    X, Y = np.meshgrid(x, y)
    vignette = 1 - 0.35 * (X**2 + Y**2)
    ax.imshow(
        vignette,
        extent=[0, SVG_WIDTH, 0, SVG_HEIGHT],
        cmap='bone',
        alpha=0.1,
        aspect='auto',
        interpolation='bilinear',
        zorder=0,
    )

    # Fold lines — subtle curved lines suggesting folded parchment
    fold_color = '#6b5b4a'
    for fx in [SVG_WIDTH * 0.33, SVG_WIDTH * 0.66]:
        ax.plot([fx, fx], [0, SVG_HEIGHT], color=fold_color, linewidth=0.4,
                alpha=0.08, zorder=0)
    for fy in [SVG_HEIGHT * 0.5]:
        ax.plot([0, SVG_WIDTH], [fy, fy], color=fold_color, linewidth=0.4,
                alpha=0.06, zorder=0)


def _jitter_polygon(coords: list[list[float]], rng: np.random.Generator, amplitude: float = 3.0) -> list[list[float]]:
    """Add slight jitter to polygon vertices for hand-drawn effect."""
    jittered = []
    for x, y in coords:
        jittered.append([
            x + rng.normal(0, amplitude),
            y + rng.normal(0, amplitude),
        ])
    return jittered


def _draw_ocean(ax: plt.Axes) -> None:
    """Fill the full canvas as ocean, then the continent will overlay."""
    ocean = plt.Rectangle((0, 0), SVG_WIDTH, SVG_HEIGHT, facecolor=OCEAN_COLOR, zorder=1)
    ax.add_patch(ocean)


def _draw_continent_outline(ax: plt.Axes, civ_polygons: list[dict], rng: np.random.Generator, layer_filter: dict[str, bool] | None = None) -> None:
    """Draw the merged continental landmass from civilization polygons."""
    # Collect all polygon points to create a rough continental hull
    all_points = []
    for feat in civ_polygons:
        coords = feat['geometry']['coordinates'][0]
        all_points.extend(coords)

    if not all_points:
        return

    if layer_filter is not None and not layer_filter.get('civilization', True):
        return

    # Draw each civ polygon as land fill
    for feat in civ_polygons:
        props = feat['properties']
        civ_id = props.get('id', '')
        coords = feat['geometry']['coordinates'][0]
        fill = CIV_FILLS.get(civ_id, PARCHMENT_BG)

        # Jitter for hand-drawn feel
        jittered = _jitter_polygon(coords, rng, amplitude=4.0)
        xs = [p[0] for p in jittered]
        ys = [SVG_HEIGHT - p[1] for p in jittered]  # Y-invert

        # Ink bleed — subtle dark outline for coastline effect
        ax.fill(xs, ys, facecolor=fill, edgecolor='#5a4535',
                linewidth=2.5, alpha=0.12, zorder=2)
        ax.fill(xs, ys, facecolor=fill, edgecolor=BORDER_COLOR,
                linewidth=1.2, alpha=0.15, zorder=3)

        # Region label at centroid (with optional override)
        civ_id = props.get('id', '')
        override = CIV_LABEL_OVERRIDES.get(civ_id)
        if override:
            cx, cy = override[0], SVG_HEIGHT - override[1]
        elif centroid := props.get('centroid'):
            cx, cy = centroid[0], SVG_HEIGHT - centroid[1]
        else:
            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)

        name = props.get('name', '')
        ax.text(cx, cy, name.upper(),
                fontsize=9, fontweight='bold', color=TEXT_COLOR,
                ha='center', va='center', fontfamily='serif',
                style='normal', zorder=20,
                path_effects=[
                    pe.withStroke(linewidth=3, foreground=PARCHMENT_BG, alpha=0.85),
                ])


def _elevation_color(elev: float, min_elev: float = -500, max_elev: float = 6000) -> str:
    """Map elevation to hypsometric color."""
    t = max(0.0, min(1.0, (elev - min_elev) / (max_elev - min_elev)))
    for i in range(len(ELEVATION_COLORS) - 1):
        t0, c0 = ELEVATION_COLORS[i]
        t1, c1 = ELEVATION_COLORS[i + 1]
        if t0 <= t <= t1:
            # Linear interpolation between colors
            ratio = (t - t0) / (t1 - t0) if t1 != t0 else 0
            r0, g0, b0 = int(c0[1:3], 16), int(c0[3:5], 16), int(c0[5:7], 16)
            r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
            r = int(r0 + ratio * (r1 - r0))
            g = int(g0 + ratio * (g1 - g0))
            b = int(b0 + ratio * (b1 - b0))
            return f'#{r:02x}{g:02x}{b:02x}'
    return ELEVATION_COLORS[-1][1]


def _draw_terrain_cells(ax: plt.Axes, terrain_cells: list[dict], layer_filter: dict[str, bool] | None = None) -> None:
    """Draw Voronoi heightmap cells with hypsometric tinting and hillshade."""
    if not terrain_cells:
        return
    if layer_filter is not None and not layer_filter.get('terrain_cell', True):
        return
    
    elevations = [f['properties']['elevation'] for f in terrain_cells]
    min_elev = -500
    max_elev = max(elevations) if elevations else 3000
    
    for feat in terrain_cells:
        elev = feat['properties']['elevation']
        coords = feat['geometry']['coordinates'][0]
        xs = [p[0] for p in coords]
        ys = [SVG_HEIGHT - p[1] for p in coords]
        
        color = _elevation_color(elev, min_elev, max_elev)
        
        # Simple hillshade: darken higher elevations slightly for depth
        hillshade_alpha = 0.88
        
        # zorder=2 so it sits above ocean(1) and under civ fills(3)
        ax.fill(xs, ys, facecolor=color, edgecolor='none', alpha=hillshade_alpha, zorder=2)

def _draw_basin(ax: plt.Axes, basin_feat: dict, rng: np.random.Generator, layer_filter: dict[str, bool] | None = None) -> None:
    """Draw the Aethelian Basin as a translucent water body."""
    if layer_filter is not None and not layer_filter.get('water', True):
        return
    coords = basin_feat['geometry']['coordinates'][0]
    jittered = _jitter_polygon(coords, rng, amplitude=3.0)
    xs = [p[0] for p in jittered]
    ys = [SVG_HEIGHT - p[1] for p in jittered]

    ax.fill(xs, ys, facecolor=BASIN_COLOR, edgecolor='#5a8aaa',
            linewidth=1.5, alpha=0.55, zorder=4)

    # Basin label
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    ax.text(cx, cy, 'A E T H E L I A N    B A S I N',
            fontsize=8, fontweight='normal', color=WATER_TEXT,
            ha='center', va='center', fontfamily='serif',
            style='italic', zorder=20,
            alpha=0.7,
            path_effects=[
                pe.withStroke(linewidth=2, foreground=BASIN_COLOR, alpha=0.6),
            ])


def _draw_rivers(ax: plt.Axes, rivers: list[dict], layer_filter: dict[str, bool] | None = None) -> None:
    """Draw river lines."""
    if layer_filter is not None and not layer_filter.get('river', True):
        return
    for feat in rivers:
        coords = feat['geometry']['coordinates']
        xs = [p[0] for p in coords]
        ys = [SVG_HEIGHT - p[1] for p in coords]
        ax.plot(xs, ys, color='#4a8ab0', linewidth=1.0, alpha=0.5,
                solid_capstyle='round', zorder=5)


def _draw_trade_routes(ax: plt.Axes, routes: list[dict], layer_filter: dict[str, bool] | None = None) -> None:
    """Draw trade routes as styled dashed lines."""
    if layer_filter is not None and not layer_filter.get('trade_route', True):
        return
    for feat in routes:
        props = feat['properties']
        route_id = props.get('id', '')
        coords = feat['geometry']['coordinates']
        xs = [p[0] for p in coords]
        ys = [SVG_HEIGHT - p[1] for p in coords]

        color = ROUTE_COLORS.get(route_id, '#888')
        dashes = ROUTE_DASHES.get(route_id, (5, 3))

        ax.plot(xs, ys, color=color, linewidth=1.8, alpha=0.75,
                dashes=dashes, solid_capstyle='round',
                dash_joinstyle='round', zorder=8)


def _draw_points(ax: plt.Axes, features: list[dict], layer_filter: dict[str, bool] | None = None) -> None:
    """Draw point markers (ports, chokepoints, oases, landmarks, contested sites)."""
    for feat in features:
        props = feat['properties']
        category = props.get('category', 'landmark')
        if layer_filter is not None and not layer_filter.get(category, True):
            continue
        name = props.get('name', '')
        x, y = feat['geometry']['coordinates']
        y = SVG_HEIGHT - y  # Invert

        cfg = MARKER_CONFIG.get(category, MARKER_CONFIG['landmark'])

        ax.scatter(x, y,
                   marker=cfg['marker'],
                   c=cfg['color'],
                   s=cfg['size'],
                   edgecolors=cfg['edgecolor'],
                   linewidths=0.8,
                   zorder=cfg['zorder'],
                   alpha=0.9)

        # Label
        label_y_offset = 8 if category != 'landmark' else 6
        fontsize = 5.5 if category == 'landmark' else 6
        fontweight = 'bold' if category in ('port', 'chokepoint') else 'normal'

        ax.text(x, y - label_y_offset, name,
                fontsize=fontsize, fontweight=fontweight,
                color=TEXT_COLOR, ha='center', va='top',
                fontfamily='serif', zorder=21,
                path_effects=[
                    pe.withStroke(linewidth=2, foreground=PARCHMENT_BG, alpha=0.85),
                ])


def _draw_compass(ax: plt.Axes) -> None:
    """Draw a simple compass rose."""
    cx, cy = 100, 150
    size = 30

    # N-S line
    ax.annotate('', xy=(cx, cy + size), xytext=(cx, cy - size),
                arrowprops=dict(arrowstyle='->', color=TEXT_COLOR, lw=1.2),
                zorder=25)
    ax.annotate('', xy=(cx, cy - size), xytext=(cx, cy + size),
                arrowprops=dict(arrowstyle='->', color=TEXT_MUTED, lw=0.8),
                zorder=25)

    # E-W line
    ax.annotate('', xy=(cx + size, cy), xytext=(cx - size, cy),
                arrowprops=dict(arrowstyle='->', color=TEXT_MUTED, lw=0.8),
                zorder=25)
    ax.annotate('', xy=(cx - size, cy), xytext=(cx + size, cy),
                arrowprops=dict(arrowstyle='->', color=TEXT_MUTED, lw=0.8),
                zorder=25)

    # Labels
    for label, dx, dy in [('N', 0, size + 10), ('S', 0, -size - 12),
                           ('E', size + 10, 0), ('W', -size - 10, 0)]:
        weight = 'bold' if label == 'N' else 'normal'
        fsize = 7 if label == 'N' else 5.5
        ax.text(cx + dx, cy + dy, label,
                fontsize=fsize, fontweight=weight, color=TEXT_COLOR,
                ha='center', va='center', fontfamily='serif', zorder=25)


def _draw_scale_bar(ax: plt.Axes) -> None:
    """Draw a scale bar."""
    # Position: bottom-left area
    bx, by = 80, 60
    bar_width = 120  # ~300 km at continental scale
    bar_height = 3

    ax.add_patch(plt.Rectangle((bx, by), bar_width, bar_height,
                               facecolor=TEXT_COLOR, edgecolor='none', zorder=25))
    ax.add_patch(plt.Rectangle((bx, by), bar_width / 2, bar_height,
                               facecolor=PARCHMENT_BG, edgecolor=TEXT_COLOR,
                               linewidth=0.5, zorder=25))

    ax.text(bx + bar_width / 2, by - 6, '~300 km',
            fontsize=5, color=TEXT_MUTED, ha='center', va='top',
            fontfamily='serif', zorder=25)
    ax.text(bx + bar_width / 2, by - 13, '(5–7 days by ship)',
            fontsize=4, color=TEXT_MUTED, ha='center', va='top',
            fontfamily='serif', style='italic', zorder=25)


def _draw_title(ax: plt.Axes) -> None:
    """Draw the title cartouche."""
    # Title text
    ax.text(SVG_WIDTH / 2, SVG_HEIGHT - 25, 'V E Y D R I A',
            fontsize=18, fontweight='bold', color=TEXT_COLOR,
            ha='center', va='center', fontfamily='serif',
            zorder=25,
            path_effects=[
                pe.withStroke(linewidth=3, foreground=PARCHMENT_BG, alpha=0.9),
            ])

    ax.text(SVG_WIDTH / 2, SVG_HEIGHT - 50, 'Continental Reference Map',
            fontsize=7, fontweight='normal', color=TEXT_MUTED,
            ha='center', va='center', fontfamily='serif',
            style='italic', zorder=25,
            path_effects=[
                pe.withStroke(linewidth=2, foreground=PARCHMENT_BG, alpha=0.9),
            ])

    # Ornamental lines
    line_y = SVG_HEIGHT - 38
    line_half = 140
    cx = SVG_WIDTH / 2
    ax.plot([cx - line_half, cx - 30], [line_y, line_y],
            color=BORDER_COLOR, linewidth=0.6, alpha=0.6, zorder=24)
    ax.plot([cx + 30, cx + line_half], [line_y, line_y],
            color=BORDER_COLOR, linewidth=0.6, alpha=0.6, zorder=24)


def _draw_legend(ax: plt.Axes, routes: list[dict], points: list[dict], layer_filter: dict[str, bool] | None = None) -> None:
    """Draw a map legend."""
    lx, ly = SVG_WIDTH - 200, 175
    box_w, box_h = 180, 185

    # Legend background
    legend_bg = FancyBboxPatch(
        (lx, ly - box_h), box_w, box_h,
        boxstyle="round,pad=6",
        facecolor=PARCHMENT_BG, edgecolor=BORDER_COLOR,
        linewidth=0.8, alpha=0.9, zorder=22,
    )
    ax.add_patch(legend_bg)

    ax.text(lx + box_w / 2, ly - 8, 'L E G E N D',
            fontsize=6, fontweight='bold', color=TEXT_COLOR,
            ha='center', va='top', fontfamily='serif', zorder=23)

    y_pos = ly - 25

    has_routes = layer_filter is None or layer_filter.get('trade_route', True)
    point_categories = ['chokepoint', 'port', 'oasis']
    has_points = layer_filter is None or any(
        layer_filter.get(cat, True) for cat in point_categories
    )

    if not has_routes and not has_points:
        return

    # Trade routes
    if has_routes:
      for feat in routes:
        props = feat['properties']
        route_id = props.get('id', '')
        name = props.get('name', route_id)
        color = ROUTE_COLORS.get(route_id, '#888')
        dashes = ROUTE_DASHES.get(route_id, (5, 3))

        ax.plot([lx + 8, lx + 38], [y_pos, y_pos],
                color=color, linewidth=1.5, dashes=dashes, zorder=23)
        ax.text(lx + 44, y_pos, name,
                fontsize=4.5, color=TEXT_COLOR, va='center',
                fontfamily='serif', zorder=23)
        y_pos -= 14

    y_pos -= 6

    # Point markers
    if has_points:
      for category, label in [('chokepoint', 'Chokepoint'), ('port', 'Basin Port Zone'),
                               ('oasis', 'Irrah Oasis City')]:
        if layer_filter is not None and not layer_filter.get(category, True):
            continue
        cfg = MARKER_CONFIG[category]
        ax.scatter(lx + 18, y_pos, marker=cfg['marker'], c=cfg['color'],
                   s=cfg['size'] * 0.7, edgecolors=cfg['edgecolor'],
                   linewidths=0.5, zorder=23)
        ax.text(lx + 32, y_pos, label,
                fontsize=4.5, color=TEXT_COLOR, va='center',
                fontfamily='serif', zorder=23)
        y_pos -= 14


def rasterize_map(
    geojson_path: Path | str | None = None,
    output_path: Path | str | None = None,
    dpi: int = DPI,
    layer_filter: dict[str, bool] | None = None,
) -> Path:
    """
    Render the Veydria map as a static PNG.

    Args:
        geojson_path: Path to the GeoJSON file. Defaults to output/veydria-spatial.geojson.
        output_path: Where to write the PNG. Defaults to output/veydria-map.png.
        dpi: Resolution in dots per inch.

    Returns:
        Path to the written PNG file.
    """
    geojson_path = Path(geojson_path) if geojson_path else DEFAULT_GEOJSON
    output_path = Path(output_path) if output_path else DEFAULT_OUTPUT

    if not geojson_path.exists():
        raise FileNotFoundError(
            f"GeoJSON not found at {geojson_path}. "
            "Run 'python pipeline.py export-geojson' first."
        )

    print(f"Loading GeoJSON from {geojson_path}...")
    data = _load_geojson(geojson_path)
    features = data['features']

    # Sort features by category
    civilizations = [f for f in features if f['properties'].get('category') == 'civilization']
    terrain_cells = [f for f in features if f['properties'].get('category') == 'terrain_cell']
    basin = [f for f in features if f['properties'].get('category') == 'water']
    routes = [f for f in features if f['properties'].get('category') == 'trade_route']
    rivers = [f for f in features if f['properties'].get('category') == 'river']
    points = [f for f in features if f['geometry']['type'] == 'Point']

    print(f"  {len(civilizations)} civilizations, {len(terrain_cells)} terrain cells, {len(routes)} routes, "
          f"{len(rivers)} rivers, {len(points)} points")

    # Create figure
    rng = np.random.default_rng(42)  # Deterministic noise

    fig, ax = plt.subplots(1, 1, figsize=(FIG_WIDTH, FIG_HEIGHT))
    ax.set_xlim(0, SVG_WIDTH)
    ax.set_ylim(0, SVG_HEIGHT)
    ax.set_aspect('equal')
    ax.axis('off')
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    print("  Drawing parchment texture...")
    _add_parchment_texture(ax, rng)

    print("  Drawing ocean...")
    _draw_ocean(ax)

    if terrain_cells and (layer_filter is None or layer_filter.get('terrain_cell', True)):
        print("  Drawing terrain cells...")
        _draw_terrain_cells(ax, terrain_cells, layer_filter)

    if civilizations and (layer_filter is None or layer_filter.get('civilization', True)):
        print("  Drawing continental regions...")
        _draw_continent_outline(ax, civilizations, rng, layer_filter)

    if basin and (layer_filter is None or layer_filter.get('water', True)):
        print("  Drawing Aethelian Basin...")
        _draw_basin(ax, basin[0], rng, layer_filter)

    if rivers and (layer_filter is None or layer_filter.get('river', True)):
        print("  Drawing rivers...")
        _draw_rivers(ax, rivers, layer_filter)

    if routes and (layer_filter is None or layer_filter.get('trade_route', True)):
        print("  Drawing trade routes...")
        _draw_trade_routes(ax, routes, layer_filter)

    if points:
        print("  Drawing points of interest...")
        _draw_points(ax, points, layer_filter)

    print("  Drawing compass rose...")
    _draw_compass(ax)

    print("  Drawing scale bar...")
    _draw_scale_bar(ax)

    print("  Drawing title...")
    _draw_title(ax)

    if (layer_filter is None
        or layer_filter.get('trade_route', True)
        or any(layer_filter.get(cat, True) for cat in ['chokepoint', 'port', 'oasis'])):
        print("  Drawing legend...")
        _draw_legend(ax, routes, points, layer_filter)

    # Add a thin border
    for spine in ax.spines.values():
        spine.set_visible(True)
        spine.set_color(BORDER_COLOR)
        spine.set_linewidth(1.5)

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=dpi, bbox_inches='tight',
                pad_inches=0.02, facecolor=PARCHMENT_BG)
    plt.close(fig)

    file_size = output_path.stat().st_size
    print(f"\nMap rendered to: {output_path}")
    print(f"File size: {file_size:,} bytes ({file_size / 1024 / 1024:.1f} MB)")
    print(f"Resolution: {int(FIG_WIDTH * dpi)} x {int(FIG_HEIGHT * dpi)} px @ {dpi} DPI")

    return output_path


if __name__ == '__main__':
    rasterize_map()
