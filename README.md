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
