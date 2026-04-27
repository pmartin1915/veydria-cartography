"""
persistence.py — Write coordinate updates back to coordinate-manifest.yaml

Provides the backend for the web map's "Edit Mode" (draggable markers).
When a marker is dragged, the new position is captured and can be persisted
via this module.

Usage:
    from generator.core.persistence import update_feature_coords, apply_patch
    update_feature_coords("lam_chen_pass", "chokepoint", [945, 170])
    apply_patch("patch.yaml")  # Apply a batch patch from the frontend
"""

from pathlib import Path
from typing import Any

from .coordinate_loader import load_manifest, DEFAULT_MANIFEST_PATH
from .yaml_io import dump_rt, flow_seq, load_rt


def update_feature_coords(feature_id: str, category: str, new_coords: list[float]) -> None:
    """
    Update the coordinates of a specific feature in coordinate-manifest.yaml.

    Args:
        feature_id: The feature's ID (e.g., "lam_chen_pass", "zang_ri").
        category: The feature category (e.g., "chokepoint", "landmark", "port").
        new_coords: [x, y] in SVG viewBox coordinates.
    """
    manifest = load_manifest()

    updated = False
    raw = manifest._raw
    coords = flow_seq(new_coords)  # match existing inline `[x, y]` style

    if category == "civilization" and feature_id in raw.get("civilizations", {}):
        raw["civilizations"][feature_id]["centroid"] = coords
        updated = True

    elif category == "chokepoint" and feature_id in raw.get("chokepoints", {}):
        raw["chokepoints"][feature_id]["coords"] = coords
        updated = True

    elif category == "port" and feature_id in raw.get("ports", {}):
        raw["ports"][feature_id]["coords"] = coords
        updated = True

    elif category == "contested_site" and feature_id in raw.get("contested_sites", {}):
        raw["contested_sites"][feature_id]["coords"] = coords
        updated = True

    elif category == "oasis" and feature_id in raw.get("oases", {}):
        raw["oases"][feature_id]["coords"] = coords
        updated = True

    elif category == "landmark":
        for lm in raw.get("landmarks", []):
            if lm.get("id") == feature_id:
                lm["coords"] = coords
                updated = True
                break

    elif category == "river" and feature_id in raw.get("rivers", {}):
        # Rivers are path-based; we don't support individual point updates here
        raise ValueError(
            f"River '{feature_id}' cannot be updated via single coords. "
            "Use apply_patch() for river path edits."
        )

    elif category == "trade_route" and feature_id in raw.get("trade_routes", {}):
        raise ValueError(
            f"Trade route '{feature_id}' cannot be updated via single coords. "
            "Use apply_patch() for route path edits."
        )

    if not updated:
        raise ValueError(
            f"Feature '{feature_id}' (category: {category}) not found in manifest."
        )

    # Write back via round-trip dumper so comments and key order survive.
    dump_rt(raw, DEFAULT_MANIFEST_PATH)

    print(f"Updated {feature_id} ({category}) -> {new_coords}")


def apply_patch(patch_path: Path | str) -> None:
    """
    Apply a YAML patch file to the coordinate manifest.

    Patch format:
        patches:
          - id: lam_chen_pass
            category: chokepoint
            coords: [945, 170]
          - id: zang_ri
            category: landmark
            coords: [560, 80]
    """
    patch_path = Path(patch_path)
    if not patch_path.exists():
        raise FileNotFoundError(f"Patch file not found: {patch_path}")

    patch = load_rt(patch_path)

    patches = patch.get("patches", [])
    if not patches:
        print("No patches to apply.")
        return

    for p in patches:
        feature_id = p.get("id")
        category = p.get("category")
        coords = p.get("coords")
        if feature_id and category and coords:
            update_feature_coords(feature_id, category, coords)
        else:
            print(f"Skipping invalid patch entry: {p}")

    print(f"Applied {len(patches)} patch(es).")


def export_patch_from_updates(updates: dict[str, dict[str, Any]], output_path: Path | str) -> None:
    """
    Export a patch file from the web frontend's coordinateUpdates state.

    Args:
        updates: Dict of feature_id -> {name, category, coords}
        output_path: Where to write the patch YAML.
    """
    patches = []
    for feature_id, data in updates.items():
        patches.append({
            "id": feature_id,
            "category": data.get("category"),
            "coords": data.get("coords"),
        })

    patch = {"patches": patches, "metadata": {"source": "web-edit-mode"}}

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dump_rt(patch, output_path)

    print(f"Exported patch with {len(patches)} update(s) to {output_path}")


def _smoke_test_round_trip() -> None:
    """
    Verify the YAML round-trip preserves comments and structure.

    Loads the live manifest, dumps it to a tempfile via the round-trip helpers,
    and asserts comment lines and a header sentinel survive. Does NOT mutate
    the real coordinate-manifest.yaml — F1's whole point is that future
    edit-mode saves won't shred it, so this test must not shred it either.
    """
    import tempfile

    sentinel = "Veydria Coordinate Manifest"
    original_text = DEFAULT_MANIFEST_PATH.read_text(encoding="utf-8")
    original_comments = sum(1 for ln in original_text.splitlines() if ln.lstrip().startswith("#"))
    assert sentinel in original_text, "Sentinel missing from source manifest."
    assert original_comments > 0, "Source manifest has no comments — test is meaningless."

    raw = load_rt(DEFAULT_MANIFEST_PATH)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False, encoding="utf-8"
    ) as tmp:
        tmp_path = Path(tmp.name)
    try:
        dump_rt(raw, tmp_path)
        round_tripped = tmp_path.read_text(encoding="utf-8")
    finally:
        tmp_path.unlink(missing_ok=True)

    rt_comments = sum(1 for ln in round_tripped.splitlines() if ln.lstrip().startswith("#"))
    assert sentinel in round_tripped, "Sentinel lost on round-trip."
    assert rt_comments == original_comments, (
        f"Comment count changed: {original_comments} → {rt_comments}"
    )

    print(f"  Round-trip OK: {original_comments} comments preserved, sentinel intact.")


if __name__ == "__main__":
    # Self-test: load manifest, verify category access, verify YAML round-trip.
    manifest = load_manifest()
    print("Persistence layer ready.")
    print(f"  Civilizations: {len(manifest.civ_names)}")
    print(f"  Chokepoints: {len(manifest.chokepoint_names)}")
    print(f"  Ports: {len(manifest.port_names)}")
    print(f"  Landmarks: {len(manifest.landmarks)}")
    print(f"  Oases: {len(manifest.oasis_names)}")
    _smoke_test_round_trip()
