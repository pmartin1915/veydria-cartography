# Handoff — Static Map Regeneration

**Date:** 2026-05-15
**Branch:** main
**Tests:** 489/489 pass (27 files)
**Build:** green (~470 kB JS, ~113 kB CSS)
**Python validation:** green

## What shipped

### Static map regeneration (layer-aware parchment render)

A bridge between the interactive web map and the Python parchment renderer. GMs can now export their current layer view as a config, then run the Python pipeline to produce a filtered, high-DPI parchment PNG.

**Web side:**
- New "Parchment" button in the header (next to Snapshot)
- Downloads `veydria-render-config-YYYY-MM-DD.json` containing only Python-renderable layer visibility
- Web-only layers (hex_grid, faction_control, terrain_cost, biome_colors) are automatically omitted

**Python side:**
- `generator/render/config.py`: `RenderConfig` dataclass with `load_render_config()`
- `generator/render/rasterize.py`: all drawing functions accept an optional `layer_filter` dict
- `generator/pipeline.py render-map --config <path>`: reads config and skips disabled categories
- Conditional logging: only prints "Drawing X..." for layers that are actually rendered

**Usage:**
```bash
# In the web app, click "Parchment" to download the config
# Then run:
cd generator
python pipeline.py render-map --config ../veydria-render-config-2026-05-15.json --dpi 300
```

**Files changed:**
- `generator/render/config.py` — new
- `generator/render/rasterize.py` — layer_filter throughout
- `generator/pipeline.py` — --config flag
- `web/src/utils/render-config.ts` — new
- `web/src/utils/render-config.test.ts` — 2 tests
- `web/src/App.tsx` — Parchment button
- `MASTER.md` — documented as shipped

## Verification

```bash
cd web && npm test -- --run        # 489/489 pass
cd web && npm run build             # green
cd generator && python pipeline.py validate  # green
```

## Next plausible moves

- **Manual mobile audit** *(small, recurring)* — real-device verification of mobile paths. I can run this since you can't right now.
- **Backlog emptied** — the only remaining backlog item is now shipped.
