---
name: veydria-cartography-context
description: Veydria Cartography — procedural map generation and interactive web map for the Veydria continent. Python backend + Vite/React/Leaflet frontend.
---

# Veydria Cartography — Kimi Context

## What This Project Is

Procedural map generation and interactive reference map for the continent of Veydria. Two outputs:

1. **Static map image** — matplotlib parchment-style continental map
2. **Interactive web map** — Leaflet viewer with lore markers, trade routes, layer controls

## Kimi's Scope

**Do:**
- UI/visual polish for the web map (CSS, markers, panels, animations)
- Interactive frontend features (controls, overlays, tooltips)
- Improve static matplotlib render aesthetics
- Component enhancements (InfoPanel, SearchBar, LayerControls)
- Fix the output/ → web/public/ wiring gap
- Implement viewport culling (rbush stash)

**Do NOT:**
- Edit `data/veydria-topology.yaml` directly — change in worldbuilder, then sync
- Modify `coordinate-manifest.yaml` structure without updating persistence.py
- Reset geometry or regenerate from scratch without confirmation
- Deploy or publish autonomously

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Data parsing | PyYAML |
| Topology | NetworkX |
| Geometry | scipy.spatial, Shapely |
| Elevation | noise (Simplex/Perlin) |
| Static render | matplotlib |
| Frontend | Vite + React 19 |
| Map engine | Leaflet (react-leaflet) |
| Vector overlay | D3.js |

## Key Paths

- `data/veydria-topology.yaml` — Canonical spatial source of truth
- `data/MAP-PROMPT.md` — Definitive visual specification
- `data/coordinate-manifest.yaml` — Editable feature coordinates
- `generator/core/persistence.py` — Round-trip YAML persistence
- `generator/render/rasterize.py` — Static map renderer
- `generator/export/geojson.py` — GeoJSON exporter
- `web/src/components/MapViewer.tsx` — Main map component
- `web/src/components/InfoPanel.tsx` — Feature detail panel
- `web/src/App.css` — All styling (dark parchment theme)

## Validation Workflow

```bash
# Backend
cd generator
python pipeline.py validate          # → [OK] Topology YAML is valid.
python pipeline.py export-geojson    # → 3,052 features, ~3.2MB
python -m generator.core.persistence # → comments preserved, sentinel intact

# Frontend
cd web
npm run dev                          # → interactive map at localhost:5173
```

## Known Issues (from last audit)

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| F2 | Critical | Open | `sync-world-data.mjs` hardcoded paths |
| F3 | High | Open | `schema_validator.py` has unused JSON Schema |
| F4 | High | Open | Export Patch button (unblocked by F1) |
| F5 | Medium | Open | `coordinate_loader.py` silent missing-key failures |
| F6 | Low | Open | `landmarks` shape mismatch in manifest |
| Wiring | High | Open | `output/` ↔ `web/public/` out of sync |
| rbush | — | Stashed | Viewport culling WIP (doesn't compile) |

## Related Repos

- `worldbuilder` — Canonical data source
- `veydria-atlas` — Map data companion
- `game-ecosystem` — Engine integration
