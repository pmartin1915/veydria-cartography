"""
schema_validator.py — Validate veydria-topology.yaml against its JSON Schema

Catches structural changes in the upstream worldbuilder repo before they
corrupt the map pipeline. Run as part of CI or before each export.

Usage:
    python -m generator.core.schema_validator
    python -m generator.core.schema_validator --strict
"""

import json
import sys
from pathlib import Path
from typing import Any

import yaml


# Schema for veydria-topology.yaml
# This defines the minimum structure expected by the pipeline.
TOPOLOGY_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": [
        "continental_shape",
        "civilization_positions",
        "chokepoints",
        "aethelian_basin",
        "trade_routes",
        "elevation_profile",
    ],
    "properties": {
        "continental_shape": {
            "type": "object",
            "required": ["model", "scale"],
            "properties": {
                "model": {"type": "string"},
                "scale": {"type": "string"},
                "real_world_analog": {"type": "string"},
            },
        },
        "civilization_positions": {
            "type": "object",
            "minProperties": 6,
            "patternProperties": {
                "^[a-z_]+$": {
                    "type": "object",
                    "required": ["cardinal", "elevation", "terrain", "borders"],
                    "properties": {
                        "cardinal": {"type": "string"},
                        "elevation": {"type": "string"},
                        "terrain": {"type": "string"},
                        "basin_access": {"type": "string"},
                        "borders": {"type": "array", "items": {"type": "string"}},
                        "second_coast": {"type": "string"},
                        "river_sources": {"type": "string"},
                    },
                },
            },
        },
        "chokepoints": {
            "type": "object",
            "minProperties": 6,
            "patternProperties": {
                "^[a-z_]+$": {
                    "type": "object",
                    "required": ["connects", "type", "description", "strategic_value"],
                    "properties": {
                        "connects": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 2,
                        },
                        "type": {"type": "string"},
                        "description": {"type": "string"},
                        "strategic_value": {"type": "string"},
                        "historic": {"type": "string"},
                        "sub_routes": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
        "aethelian_basin": {
            "type": "object",
            "required": ["type", "description", "opening", "functional_zones"],
            "properties": {
                "type": {"type": "string"},
                "description": {"type": "string"},
                "opening": {"type": "string"},
                "functional_zones": {
                    "type": "object",
                    "minProperties": 4,
                    "patternProperties": {
                        "^[a-z_]+$": {
                            "type": "object",
                            "required": ["in_world_name", "etymology", "location", "function"],
                            "properties": {
                                "in_world_name": {"type": "string"},
                                "etymology": {"type": "string"},
                                "real_world_parallel": {"type": "string"},
                                "location": {"type": "string"},
                                "function": {"type": "string"},
                            },
                        },
                    },
                },
                "contested_sites": {
                    "type": "object",
                    "patternProperties": {
                        "^[a-z_]+$": {
                            "type": "object",
                            "required": ["location", "description"],
                            "properties": {
                                "location": {"type": "string"},
                                "description": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
        "trade_routes": {
            "type": "object",
            "minProperties": 5,
            "patternProperties": {
                "^[a-z_]+$": {
                    "type": "object",
                    "required": ["endpoints", "path", "commodities", "bottleneck", "consequence_if_closed"],
                    "properties": {
                        "endpoints": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 2,
                        },
                        "path": {"type": "string"},
                        "commodities": {"type": "string"},
                        "bottleneck": {"type": "string"},
                        "consequence_if_closed": {"type": "string"},
                    },
                },
            },
        },
        "biological_barriers": {
            "type": "object",
            "patternProperties": {
                "^[a-z_]+$": {
                    "type": "object",
                    "required": ["location", "effect", "consequence"],
                    "properties": {
                        "location": {"type": "string"},
                        "effect": {"type": "string"},
                        "consequence": {"type": "string"},
                    },
                },
            },
        },
        "elevation_profile": {
            "type": "object",
            "required": ["description", "bands"],
            "properties": {
                "description": {"type": "string"},
                "bands": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["region", "elevation_m", "notes"],
                        "properties": {
                            "region": {"type": "string"},
                            "elevation_m": {"type": "string"},
                            "notes": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}


def validate_topology(data: dict[str, Any]) -> list[str]:
    """
    Validate topology data against the schema.

    Returns a list of error messages (empty if valid).
    """
    errors: list[str] = []

    # Check required top-level keys
    for key in TOPOLOGY_SCHEMA["required"]:
        if key not in data:
            errors.append(f"Missing required top-level key: '{key}'")

    # Check civilizations
    civs = data.get("civilization_positions", {})
    expected_civs = {"ngaru_bon", "irrah", "kheshkai", "ndjadi", "qollari", "oravan"}
    actual_civs = set(civs.keys())
    if not expected_civs.issubset(actual_civs):
        missing = expected_civs - actual_civs
        errors.append(f"Missing expected civilizations: {sorted(missing)}")
    for civ_key, civ_data in civs.items():
        if "borders" in civ_data and not isinstance(civ_data["borders"], list):
            errors.append(f"civilization_positions.{civ_key}.borders must be a list")

    # Check chokepoints
    cps = data.get("chokepoints", {})
    expected_cps = {
        "lam_chen_pass",
        "a_tzalan_ford",
        "qollari_cliff_roads",
        "halkar_straits",
        "smith_spring",
        "breath_of_cloud",
    }
    actual_cps = set(cps.keys())
    if not expected_cps.issubset(actual_cps):
        missing = expected_cps - actual_cps
        errors.append(f"Missing expected chokepoints: {sorted(missing)}")
    for cp_key, cp_data in cps.items():
        connects = cp_data.get("connects", [])
        if len(connects) < 2:
            errors.append(f"chokepoints.{cp_key}.connects must have at least 2 entries")

    # Check basin port zones
    basin = data.get("aethelian_basin", {})
    zones = basin.get("functional_zones", {})
    expected_ports = {"ki_mbuhari", "tavakh_qarat", "halani_tamu", "dzong_tamu"}
    actual_ports = set(zones.keys())
    if not expected_ports.issubset(actual_ports):
        missing = expected_ports - actual_ports
        errors.append(f"Missing expected port zones: {sorted(missing)}")

    # Check trade routes
    routes = data.get("trade_routes", {})
    expected_routes = {
        "copper_for_steel_road",
        "highland_steppe_corridor",
        "highland_relay",
        "coastal_monsoon",
        "caravan_thread",
    }
    actual_routes = set(routes.keys())
    if not expected_routes.issubset(actual_routes):
        missing = expected_routes - actual_routes
        errors.append(f"Missing expected trade routes: {sorted(missing)}")

    # Check elevation profile
    elev = data.get("elevation_profile", {})
    bands = elev.get("bands", [])
    band_regions = {b.get("region") for b in bands}
    if len(band_regions) < 6:
        errors.append(f"elevation_profile.bands should cover at least 6 regions, found {len(band_regions)}")

    return errors


def validate_topology_file(path: Path | str | None = None) -> list[str]:
    """Load and validate a topology YAML file."""
    from .yaml_loader import DEFAULT_TOPOLOGY_PATH

    path = Path(path) if path else DEFAULT_TOPOLOGY_PATH
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return validate_topology(data)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Validate veydria-topology.yaml")
    parser.add_argument("-i", "--input", type=Path, default=None, help="Path to topology YAML")
    parser.add_argument("--strict", action="store_true", help="Exit with error code on warnings")
    args = parser.parse_args()

    errors = validate_topology_file(args.input)

    if errors:
        print(f"[FAIL] Validation failed with {len(errors)} error(s):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print("[OK] Topology YAML is valid.")
        sys.exit(0)
