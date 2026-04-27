# HANDOFF — veydria-cartography Phase 1

**Date:** 2026-04-24
**Branch:** master · **Last commit:** `9bba396` (handoff) on top of `616beea` (Phase 1)
**Status:** Phase 1 complete + audited. Working tree clean.

---

## TL;DR

- Phase 1 (Foundation & Data Integrity) is shipped: hardcoded SVG coordinates
  are now in [data/coordinate-manifest.yaml](data/coordinate-manifest.yaml);
  topology is validated; pipeline exports 3,052 GeoJSON features cleanly.
- A cross-model audit (`gemini-2.5-pro` via PAL, per [DISPATCH.md](DISPATCH.md))
  surfaced **6 actionable issues** — see the Phase 2 punch list below.
- **Start here:** F1 (`persistence.py` is destroying YAML comments on write)
  is the highest-leverage fix and unblocks F4 (frontend edit-mode write-back).
- Phase 2 proper (grounded terrain & hydrology) is still gated on the three
  stub modules — `hydrology.py`, `biomes.py`, `graph_builder.py` — being
  implemented.

---

## Phase 1 — what shipped

| Status | File | Purpose |
| --- | --- | --- |
| ✅ | [data/coordinate-manifest.yaml](data/coordinate-manifest.yaml) | 574 lines, 10 categories — single source of truth for SVG positions |
| ✅ | [generator/core/coordinate_loader.py](generator/core/coordinate_loader.py) | `CoordinateManifest` class with typed accessors per category |
| ✅ | [generator/core/schema_validator.py](generator/core/schema_validator.py) | Validates `veydria-topology.yaml` structure (CLI: `pipeline.py validate`) |
| ✅ | [generator/core/persistence.py](generator/core/persistence.py) | Write-back layer for edit-mode patches (`update_feature_coords`, `apply_patch`) |
| ✅ | [generator/export/geojson.py](generator/export/geojson.py) | Refactored — loads coords via `_get_manifest()`, no hardcoded constants |
| ✅ | [generator/pipeline.py](generator/pipeline.py) | 5 subcommands: `export-geojson`, `validate`, `info`, `render-map`, `export-azgaar` |
| ✅ | [scripts/sync-world-data.mjs](scripts/sync-world-data.mjs) | Pulls canonical files from `worldbuilder` repo (`--check` for CI) |
| ⏸ | [generator/core/hydrology.py](generator/core/hydrology.py) | Stub (15 lines, raises `NotImplementedError`) — Phase 2 |
| ⏸ | [generator/core/biomes.py](generator/core/biomes.py) | Stub — Phase 2 |
| ⏸ | [generator/core/graph_builder.py](generator/core/graph_builder.py) | Stub — Phase 3 |

---

## Architecture snapshot

```text
Before: veydria-topology.yaml → geojson.py (hardcoded coords) → GeoJSON
After:  veydria-topology.yaml (narrative)  ┐
        coordinate-manifest.yaml (visual)  ┴→ geojson.py → GeoJSON → PNG/web
```

Narrative geography (which civilizations exist, how they relate) is now
decoupled from visual positions (where things appear on the map). Edit either
file independently; `pipeline.py validate` catches structural drift.

---

## Phase 2 punch list (from cross-model audit)

Tackle in numeric order — F1/F2 are persistence-hygiene, both touched by the
same dependency change, and unlock F4.

| ID | Sev | Where | What & why |
| --- | --- | --- | --- |
| **F1** | 🔴 Critical | [persistence.py:83](generator/core/persistence.py#L83) | `yaml.dump(raw, f, ...)` discards all comments and key ordering in `coordinate-manifest.yaml`. First edit-mode save will silently delete the rich inline documentation. **Fix:** swap `pyyaml` for `ruamel.yaml` with `preserve_quotes=True` at all three write sites. |
| **F2** | 🔴 Critical | [sync-world-data.mjs:14-15](scripts/sync-world-data.mjs#L14-L15) | Hardcoded `C:/Users/perry/...` paths break the script for everyone else and any CI runner. **Fix:** `process.env.WORLDBUILDER_PATH ?? resolve(__dirname, '../../worldbuilder')`. |
| **F3** | 🟠 High | [schema_validator.py:181](generator/core/schema_validator.py#L181) | A complete JSON Schema draft-07 (`TOPOLOGY_SCHEMA`) is defined but unused — the function falls back to hand-rolled `expected_civs` set checks. Misspelled fields, wrong types, and unexpected keys all slip through. **Fix:** `jsonschema.validate(data, TOPOLOGY_SCHEMA)` — the schema is already there. |
| **F4** | 🟠 High | [App.tsx:207-227](web/src/App.tsx#L207-L227) | The "Modified Coordinates" panel only renders human-readable YAML fragments. There is **no download button** producing the `patches: [{id, category, coords}]` format that [persistence.py:apply_patch](generator/core/persistence.py#L88) expects. Edit mode is observed but not persisted — a UX dead-end. **Fix:** Add an "Export Patch" button that emits the right shape, and document the `apply_patch` round-trip in the README. |
| **F5** | 🟡 Medium | [coordinate_loader.py:64](generator/core/coordinate_loader.py#L64) | `get_civ()` and siblings return `{}` on missing keys, so a manifest/topology mismatch silently drops features from GeoJSON output. **Fix:** return `None`, log a warning at the call site in `geojson.py`. |
| **F6** | 🟢 Low | [coordinate-manifest.yaml](data/coordinate-manifest.yaml) `landmarks` | `landmarks` is a list while every other category is an id-keyed dict — forces the O(n) loop at [persistence.py:57](generator/core/persistence.py#L57). **Fix:** convert to `{id: {...}}`, update the loader and `update_feature_coords` branch. |

**Wiring gap (not a defect, but a footgun):** `pipeline.py export-geojson`
writes to [output/veydria-spatial.geojson](output/veydria-spatial.geojson), but
the web app fetches `/veydria-spatial.geojson` from
[web/public/](web/public/). The file must be copied manually after every
export. Either teach `export-geojson` to write both paths, or symlink, or
have Vite serve from `../output`.

---

## Phase 2–4 roadmap

### Phase 2 — Grounded terrain & hydrology

- Replace Perlin-noise Voronoi cells in `geojson.py` with constraint-based
  interpolation from the YAML elevation profile.
- Implement `hydrology.py`: A* river routing from Kheshkai escarpment +
  Qollari cloud forest → Hassag-Nganin confluence → 5 distributaries.
- Implement `biomes.py`: Köppen-like classification (equatorial monsoon,
  arid, alpine, cloud forest, steppe).

### Phase 3 — Network & consistency validation

- Implement `graph_builder.py` — NetworkX graph with travel-time edges.
- Route plausibility checker: every trade route must be traceable on the
  network.
- "World State" overlay: toggle chokepoint control, monsoon season, route
  closures; click "close chokepoint" → gray dependent routes.

### Phase 4 — Immersive polish

- Animated D3 trade-route particle flows (already partially in place).
- Historical timeline scrubber (pre/during/post Obsidian Blockade).
- Parchment static map v2 with hillshading and wind arrows.
- Deep-link info panels back to upstream `worldbuilder` lore files.

---

## Verification

```bash
python generator/pipeline.py validate          # → [OK] Topology YAML is valid.
python generator/pipeline.py export-geojson    # → 3,052 features, ~3.2MB
python generator/pipeline.py info              # → civ/chokepoint/route summary
node scripts/sync-world-data.mjs --check       # → 3/3 up to date
```

---

## Known risks / open questions

1. **Coordinate drift** — `coordinate-manifest.yaml` was hand-extracted from
   the old `geojson.py` constants. If `data/veydria-schematic.svg` has moved
   on, positions are slightly off. Edit mode (once F1+F4 are landed) is the
   correction path.
2. **Voronoi terrain cells still procedural** — Perlin + civ bias. Phase 2
   replaces this.
3. **Three stubs remain** — `graph_builder.py`, `biomes.py`, `hydrology.py`.
4. **Worldbuilder sync not portable** — see F2 above.
