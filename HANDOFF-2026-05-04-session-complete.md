# Veydria Cartography — Session Handoff

**Date:** 2026-05-04
**Commits:** `f5165c3` — feat: self-hosted fonts, layer opacity, related features, route animation, patch loader
**Dev server:** `http://localhost:5178`

---

## Completed This Session

### 1. Self-Hosted Fonts (Offline Support)
- **Files:** `web/public/fonts/` (8 WOFF2 files + `fonts.css`)
- Downloaded Cormorant Garamond (400i, 400, 600, 700) and Inter (300, 400, 500, 600) from Google Fonts
- Replaced Google Fonts CDN link in `web/index.html` with local `/fonts/fonts.css`
- Fonts now work offline; no external network dependency for typography

### 2. Layer Opacity Sliders
- **Files:** `web/src/components/LayerControls.tsx`, `web/src/components/MapViewer.tsx`, `web/src/App.tsx`, `web/src/App.css`
- Added `LayerOpacity` type with per-layer defaults (terrain: 0.85, civ: 0.15, water: 0.5, routes: 0.75, rivers: 0.6)
- `LayerControls` shows a compact slider (0-100%) for layers marked `opacityControl: true`
- Sliders appear only when layer is toggled ON
- `MapViewer` applies opacity dynamically via `setStyle()` on polygons/polylines and `setOpacity()` on D3 overlay
- D3 overlay extended with `setOpacity()` method

### 3. Related-Features Panel in InfoPanel
- **Files:** `web/src/components/InfoPanel.tsx`, `web/src/utils/related-features.ts`, `web/src/App.tsx`, `web/src/App.css`
- `InfoPanel` now accepts `allFeatures` and `onSelectFeature` props
- `related-features.ts` computes relationships by:
  - Trade route endpoints → connected civilizations
  - Civilization → trade routes, chokepoints, ports
  - Geographic proximity (nearest features, skipping terrain/water)
- Related features render as clickable rows with relation type icon + distance
- Clicking a related feature flies to it and updates URL hash

### 4. Route Travel Animation
- **File:** `web/src/utils/d3-overlay.ts`
- Added animated gold particles that travel along each trade route path
- Particles use `getPointAtLength()` + `requestAnimationFrame` for smooth movement
- Fade in/out at path endpoints for seamless looping
- Particle count scales with route importance (2-3 per route)
- Animation pauses when layer is hidden, resumes when shown

### 5. Live Patch Apply (Edit Mode)
- **Files:** `web/src/utils/patch-parser.ts`, `web/src/App.tsx`
- Simple YAML parser for coordinate patch files
- Edit mode panel now has a file input to load `.yaml`/`.yml` patches
- Patches are applied in-memory to the GeoJSON and trigger re-render
- Toast notification shows applied/skipped counts
- Existing export patch functionality unchanged

---

## Git State
- `master`: 6 commits ahead of origin (`f5165c3`)
- Working tree: clean
- Dev server: running on `:5178` (PID 66112)

## Files Changed (18)
```
M  web/index.html
A  web/public/fonts/*          (9 files)
M  web/src/App.css
M  web/src/App.tsx
M  web/src/components/InfoPanel.tsx
M  web/src/components/LayerControls.tsx
M  web/src/components/MapViewer.tsx
M  web/src/utils/d3-overlay.ts
A  web/src/utils/patch-parser.ts
A  web/src/utils/related-features.ts
```

## Build
- TypeScript: clean (`tsc --noEmit` passes)
- Production build: 433 KB JS (gz: 133 KB), 41 KB CSS (gz: 12 KB)

## Active Issues
- Dev server port drift: `:5178` (5173-5177 occupied from prior sessions)
- Stash `stash@{0}` still contains old rbush viewport culling code; can be dropped

## Recommended Next Steps
1. Self-hosted fonts ✓ (done)
2. Layer opacity sliders ✓ (done)
3. Related-features panel ✓ (done)
4. Route travel animation ✓ (done)
5. Live patch apply ✓ (done)

**Next priorities:**
- Mini-map inset (leaflet-minimap or custom)
- InfoPanel: show route travel time estimates
- Search: fuzzy matching on etymology/description
- Mobile: touch gestures for measure mode
