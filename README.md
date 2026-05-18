# Veydria Cartography

Procedural map generation and interactive reference map for the continent of Veydria.

## Two Outputs, One Source

1. **Static map image** — procedurally generated parchment-style continental map
2. **Interactive web map** — pan/zoom Leaflet viewer with clickable lore markers and trade route overlays

Both are driven by `data/veydria-topology.yaml` (spatial source of truth) and `data/MAP-PROMPT.md` (definitive visual specification).

## Project Structure

```
veydria-cartography/
├── data/                  # Copied from worldbuilder repo (canonical source)
├── generator/             # Python backend
│   ├── core/              # YAML parsing, graph building, geometry
│   ├── render/            # matplotlib rasterization, tiling
│   └── export/            # GeoJSON conversion
├── output/                # Generated artifacts
└── web/                   # Vite + React + Leaflet frontend
```

## Quick Start

### Generate GeoJSON from YAML

```bash
cd generator
python -m venv .venv
.venv\Scripts\activate     # Windows
pip install -r requirements.txt
python pipeline.py export-geojson
```

### Run the interactive map

```bash
cd web
npm install
npm run dev
```

## Canonical Data Source

The files in `data/` are **copies** from the worldbuilder repo:
- `veydria-topology.yaml` ← `worldbuilder/geography/continents/veydria-topology.yaml`
- `MAP-PROMPT.md` ← `worldbuilder/geography/MAP-PROMPT.md`
- `veydria-schematic.svg` ← `worldbuilder/geography/veydria-schematic.svg`

If the worldbuilder files change, re-copy them here. The worldbuilder repo is the canonical source of truth.

## Companion surface: worldbuilder map-viewer

This repo is the **play surface** (hex grid, encounters, journey planning,
session prep, per-hex annotations). The sibling worldbuilder repo at
`worldbuilder/tools/map-viewer/` is the **canon-audit surface** and hosts the
**canonical compendium** (11+ lenses, full-body search, crisis dashboard,
sacred registers, pilgrimage routes, reform movements).

`web/src/components/CompendiumPanel.tsx` is a **subordinate Phase 1 copy** for
at-the-table reference. New compendium lens work lands in worldbuilder, not
here. For depth, the panel deep-links out via `VITE_WORLDBUILDER_COMPENDIUM_URL`
(see `web/.env.example`).

See `RECONCILIATION-PLAN-MAP-COMPENDIUM-2026-05-18.md` in the worldbuilder repo
root for the audience-split rationale and the deep-link contract
(`#compendium?id=…`, `#map?focus=kind:slug`).

## Tech Stack

| Layer | Library | Purpose |
|-------|---------|---------|
| Data parsing | PyYAML | Ingest YAML config |
| Topology | NetworkX | Graph + force-directed layout |
| Geometry | scipy.spatial | Voronoi tessellation |
| Shape constraint | Shapely | C-shape boolean masking |
| Elevation | noise | Simplex/Perlin for terrain |
| Static render | matplotlib | Base image generation |
| Frontend | Vite + React | Web app scaffold |
| Map engine | Leaflet (react-leaflet) | Pan/zoom/CRS.Simple |
| Vector overlay | D3.js | GeoJSON rendering over tiles |
