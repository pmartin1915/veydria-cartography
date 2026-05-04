# Veydria Cartography — Agent Context

## Overview

Procedural map generation and interactive reference map for the continent of Veydria. Two outputs from one source:

1. **Static map image** — procedurally generated parchment-style continental map (matplotlib)
2. **Interactive web map** — pan/zoom Leaflet viewer with clickable lore markers and trade route overlays

Both are driven by `data/veydria-topology.yaml` (spatial source of truth) and `data/MAP-PROMPT.md` (definitive visual specification).

## Design

- **Data parsing:** PyYAML → NetworkX graph → scipy.spatial Voronoi → Shapely masking
- **Static render:** matplotlib rasterization, parchment aesthetic
- **Frontend:** Vite + React 19 + Leaflet (react-leaflet) + D3.js for vector overlays
- **Data sync:** `scripts/sync-world-data.mjs` copies canonical files from worldbuilder

## Structure

```
veydria-cartography/
├── data/                  # Canonical spatial data (copied from worldbuilder)
│   ├── veydria-topology.yaml
│   ├── coordinate-manifest.yaml
│   ├── MAP-PROMPT.md
│   └── veydria-schematic.svg
├── generator/             # Python backend
│   ├── core/              # YAML parsing, graph building, geometry, persistence
│   ├── render/            # matplotlib rasterization, tiling
│   ├── export/            # GeoJSON conversion
│   └── pipeline.py        # CLI entry point
├── output/                # Generated artifacts
│   ├── veydria-map.png
│   ├── veydria-spatial.geojson
│   └── azgaar-heightmap.png
├── scripts/
│   └── sync-world-data.mjs
└── web/                   # Vite + React + Leaflet frontend
    ├── src/
    │   ├── components/
    │   │   ├── MapViewer.tsx
    │   │   ├── InfoPanel.tsx
    │   │   ├── LayerControls.tsx
    │   │   └── SearchBar.tsx
    │   ├── utils/
    │   │   └── d3-overlay.ts
    │   ├── App.tsx
    │   ├── App.css
    │   └── main.tsx
    └── public/
        └── veydria-spatial.geojson
```

## Commands

### Backend
```bash
cd generator
python pipeline.py validate          # Validate topology YAML
python pipeline.py export-geojson    # Generate GeoJSON (~3,052 features, ~3.2MB)
python pipeline.py info              # Civ/chokepoint/route summary
python -m generator.core.persistence # Test round-trip YAML persistence
```

### Frontend
```bash
cd web
npm install
npm run dev          # Dev server
npm run build        # Production build
npm run sync:data    # Sync worldbuilder data
```

### Data Sync
```bash
# From repo root
node scripts/sync-world-data.mjs
# Or with custom worldbuilder path:
WORLDBUILDER_PATH=/path/to/worldbuilder node scripts/sync-world-data.mjs
```

## Canonical Data Source

The files in `data/` are **copies** from the worldbuilder repo:
- `veydria-topology.yaml` ← `worldbuilder/geography/continents/veydria-topology.yaml`
- `MAP-PROMPT.md` ← `worldbuilder/geography/MAP-PROMPT.md`
- `veydria-schematic.svg` ← `worldbuilder/geography/veydria-schematic.svg`

Worldbuilder is the canonical source of truth. Re-copy when it changes.

## Session Protocol

Follow `combo/SESSION_PROTOCOL.md` for the 5-phase workflow.

## Kimi's Role

- **UI / visual tasks:** Frontend polish, CSS, marker redesign, panel styling, animations
- **Interactive features:** New map controls, tooltips, overlays, viewport optimizations
- **Static renders:** Improve matplotlib output aesthetics
- **Component work:** InfoPanel, LayerControls, SearchBar enhancements

**Do NOT:**
- Change `data/veydria-topology.yaml` directly — edit in worldbuilder, then sync
- Modify coordinate-manifest.yaml structure without updating persistence.py
- Reset geometry or regenerate from scratch without confirmation
- Deploy or publish autonomously

## Related Projects

- `worldbuilder` — Canonical data source (geography, factions, magic, religion)
- `veydria-atlas` — Map data companion
- `game-ecosystem` — Engine integration
