"""
pipeline.py — CLI entry point for the Veydria map generation pipeline.

Usage:
    python pipeline.py export-geojson              # YAML → GeoJSON
    python pipeline.py export-geojson -o out.json   # Custom output path
    python pipeline.py render-map                   # GeoJSON → PNG
    python pipeline.py render-map --dpi 300          # High-res render
    python pipeline.py info                         # Print topology summary
"""

import argparse
import shutil
import sys
from pathlib import Path

# Force UTF-8 output on Windows to handle arrows and other Unicode in YAML data
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add parent to path so we can import generator modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from generator.core.yaml_loader import load_topology
from generator.core.schema_validator import validate_topology_file
from generator.export.geojson import export_geojson
from generator.export.azgaar import export_azgaar_heightmap
from generator.render.rasterize import rasterize_map


def cmd_export_geojson(args: argparse.Namespace) -> None:
    """Export topology data to GeoJSON."""
    print("Loading veydria-topology.yaml...")
    data = load_topology(args.input)

    print(f"  {len(data.civ_names)} civilizations")
    print(f"  {len(data.chokepoint_names)} chokepoints")
    print(f"  {len(data.route_names)} trade routes")
    print(f"  {len(data.port_zones)} port zones")
    print(f"  {len(data.contested_sites)} contested sites")

    output = export_geojson(data, args.output)
    print(f"\nGeoJSON written to: {output}")
    print(f"File size: {output.stat().st_size:,} bytes")

    # Quick validation
    import json
    with open(output, "r", encoding="utf-8") as f:
        collection = json.load(f)
    n = len(collection["features"])
    print(f"Features: {n}")

    # Count by category
    cats: dict[str, int] = {}
    for feat in collection["features"]:
        cat = feat["properties"].get("category", "unknown")
        cats[cat] = cats.get(cat, 0) + 1
    for cat, count in sorted(cats.items()):
        print(f"  {cat}: {count}")

    # Copy to web/public so the frontend stays in sync
    web_public = Path(__file__).parent.parent / "web" / "public" / "veydria-spatial.geojson"
    shutil.copy2(output, web_public)
    print(f"\nSynced to web: {web_public}")


def cmd_validate(args: argparse.Namespace) -> None:
    """Validate topology YAML against schema."""
    path = args.input
    if path is None:
        from generator.core.yaml_loader import DEFAULT_TOPOLOGY_PATH
        path = DEFAULT_TOPOLOGY_PATH
    print(f"Validating {path}...")
    errors = validate_topology_file(path)
    if errors:
        print(f"[FAIL] Validation failed with {len(errors)} error(s):")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    else:
        print("[OK] Topology YAML is valid.")


def cmd_info(args: argparse.Namespace) -> None:
    """Print a summary of the topology data."""
    data = load_topology(args.input)
    print("=" * 60)
    print("VEYDRIA TOPOLOGY - SPATIAL SUMMARY")
    print("=" * 60)
    print(f"\nShape: {data.continental_shape.get('model', '?')}")
    print(f"Scale: {data.continental_shape.get('scale', '?')}")

    print(f"\n--- Civilizations ({len(data.civ_names)}) ---")
    for name in data.civ_names:
        civ = data.get_civ(name)
        print(f"  {name:15s}  {civ.get('cardinal', ''):30s}  {civ.get('elevation', '')}")

    print(f"\n--- Chokepoints ({len(data.chokepoint_names)}) ---")
    for name in data.chokepoint_names:
        cp = data.get_chokepoint(name)
        connects = " <-> ".join(cp.get("connects", []))
        print(f"  {name:20s}  {connects}")

    print(f"\n--- Trade Routes ({len(data.route_names)}) ---")
    for name in data.route_names:
        rt = data.get_route(name)
        endpoints = ", ".join(rt.get("endpoints", []))
        print(f"  {name:30s}  [{endpoints}]")

    print(f"\n--- Port Zones ({len(data.port_zones)}) ---")
    for key, zone in data.port_zones.items():
        iw = zone.get("in_world_name", key)
        loc = zone.get("location", "?")
        print(f"  {iw:16s}  {loc}")

    print(f"\n--- Contested Sites ({len(data.contested_sites)}) ---")
    for key, site in data.contested_sites.items():
        print(f"  {key:15s}  {site.get('location', '?')}")

    print(f"\n--- Elevation Profile ---")
    for band in data.elevation_profile.get("bands", []):
        print(f"  {band['region']:15s}  {band['elevation_m']:>12s}m  {band.get('notes', '')}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Veydria Cartography — Map generation pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-i", "--input",
        type=Path,
        default=None,
        help="Path to veydria-topology.yaml (default: data/veydria-topology.yaml)",
    )

    sub = parser.add_subparsers(dest="command", help="Available commands")

    # export-geojson
    p_export = sub.add_parser("export-geojson", help="Export topology to GeoJSON")
    p_export.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Output GeoJSON path (default: output/veydria-spatial.geojson)",
    )

    # validate
    sub.add_parser("validate", help="Validate topology YAML against schema")

    # info
    sub.add_parser("info", help="Print topology summary")

    # render-map
    p_render = sub.add_parser("render-map", help="Render GeoJSON to parchment-style PNG")
    p_render.add_argument(
        "-g", "--geojson",
        type=Path,
        default=None,
        help="Input GeoJSON path (default: output/veydria-spatial.geojson)",
    )
    p_render.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Output PNG path (default: output/veydria-map.png)",
    )
    p_render.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Resolution in DPI (default: 200)",
    )

    # export-azgaar
    p_azgaar = sub.add_parser("export-azgaar", help="Export Voronoi elevation to Azgaar heightmap PNG")
    p_azgaar.add_argument(
        "-o", "--output",
        type=Path,
        default=Path("output/azgaar-heightmap.png"),
        help="Output PNG path (default: output/azgaar-heightmap.png)",
    )
    p_azgaar.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Resolution in DPI (default: 200)",
    )

    args = parser.parse_args()

    if args.command == "export-geojson":
        cmd_export_geojson(args)
    elif args.command == "export-azgaar":
        data = load_topology(args.input)
        export_azgaar_heightmap(data, args.output, dpi=args.dpi)
    elif args.command == "render-map":
        rasterize_map(
            geojson_path=args.geojson,
            output_path=args.output,
            dpi=args.dpi,
        )
    elif args.command == "validate":
        cmd_validate(args)
    elif args.command == "info":
        cmd_info(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
