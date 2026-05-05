# Veydria Cartography — Session Handoff

**Date:** 2026-05-04  
**Commits pushed to origin/master:** `5459886` (8 commits total this session)  
**Dev server:** `http://localhost:5178` (PID 66112)

---

## What Was Built This Session

### Features (5)

1. **Self-Hosted Fonts** — `web/public/fonts/` (8 WOFF2 files + `fonts.css`)  
   Cormorant Garamond (400i, 400, 600, 700) + Inter (300, 400, 500, 600). Replaced Google Fonts CDN. Offline-capable typography.

2. **Layer Opacity Sliders** — `LayerControls.tsx`, `MapViewer.tsx`, `App.tsx`  
   Per-layer opacity state (0-1) with compact sliders appearing under active toggles. Applies live to polygons, polylines, and D3 trade routes.

3. **Related-Features Panel** — `InfoPanel.tsx`, `related-features.ts`  
   Shows up to 10 related features for any selected item. Relationships computed from trade route endpoints, civilization borders/ports/chokepoints, and geographic proximity. Click flies to feature.

4. **Route Travel Animation** — `d3-overlay.ts`  
   Animated gold particles travel along each trade route using `getPointAtLength()` + `requestAnimationFrame`. Fade in/out at endpoints. Pauses when routes hidden.

5. **Live Patch Loader** — `patch-parser.ts`, `App.tsx`  
   Edit mode panel has file picker for YAML patch files. Parses coordinate patches, applies immutably to GeoJSON, triggers re-render. Toast shows applied/skipped counts.

### Prior Session Features (Still Active)

- Viewport deep-linking (`url-hash.ts`) — URL captures zoom + center + feature
- Share button — copies current view URL to clipboard
- Measurement tool — Backspace undo, per-segment labels, stats panel
- Keyboard shortcuts help overlay (`Shift+?`)

---

## Audit Fixes Applied

All 10 issues from the PAL MCP codereview were fixed in commit `5459886`:

| Issue | File | Fix |
|-------|------|-----|
| O(n²) related features scan | `related-features.ts` | Spatial culling: skip water/terrain, max distance threshold, partial sort |
| setTimeout memory leaks | `App.tsx` | 5 timeout refs + unmount cleanup |
| Keyboard handler re-binding | `App.tsx` | Ref-based state access, effect deps reduced to `[handleClosePanel]` |
| GeoJSON mutation | `patch-parser.ts` | Deep-clone features via spread before updating coordinates |
| D3 RAF leak | `d3-overlay.ts` | `stopAnimation()` + cancel `particleRafId` before `startAnimation()` |
| Backspace handler re-bind | `MapViewer.tsx` | Removed `measurePoints.length` from effect deps |
| Dead code | `MapViewer.tsx` | Removed unused `animFrameIdsRef` |
| `replaceAll` for underscores | `InfoPanel.tsx`, `related-features.ts` | `replaceAll('_', ' ')` instead of `replace` |
| Type support | `tsconfig.json` | Added `"ES2021.String"` to lib array |

---

## Git State

- `origin/master`: up to date with `5459886`
- Working tree: clean
- 8 commits ahead of previous origin (now pushed)

---

## File Inventory (Changed This Session)

```
M  web/index.html
A  web/public/fonts/*               (9 files: 8 woff2 + fonts.css)
M  web/src/App.css
M  web/src/App.tsx
M  web/src/components/InfoPanel.tsx
M  web/src/components/LayerControls.tsx
M  web/src/components/MapViewer.tsx
M  web/src/utils/d3-overlay.ts
A  web/src/utils/patch-parser.ts
A  web/src/utils/related-features.ts
M  web/tsconfig.json
```

---

## Build

- TypeScript: clean (`tsc --noEmit` passes)
- Production build: 434 KB JS (gz: 133 KB), 41 KB CSS (gz: 12 KB)

---

## Active Issues

- **Dev server port drift:** `:5178` (5173-5177 occupied from prior sessions)
- **Stash `stash@{0}`:** contains old rbush viewport culling code; can be dropped

---

## Architecture Notes for Next Instance

### State Flow
```
App.tsx
├── geojson (fetched once, mutable via patch apply)
├── layers / opacities (LayerControls → MapViewer)
├── selectedFeature / panelOpen (InfoPanel, deep-linking)
├── measureMode / measureStats (MapViewer measurement overlay)
├── viewportRef + hashUpdateTimeoutRef (URL hash throttling)
└── coordinateUpdates (edit mode, exportable patches)
```

### Key Patterns
- **Refs for stable values:** `viewportRef`, `measureModeRef`, `searchOpenRef` — used to avoid effect re-binding
- **Timeout ref cleanup:** All `setTimeout` calls use refs + `clearTimeout` on unmount
- **Immutable patches:** `patch-parser.ts` deep-clones features via `{ ...feature, geometry: { ... } }`
- **D3 overlay lifecycle:** `initD3Overlay` returns `{ update, destroy, setVisibility, setOpacity }`. Stored duck-typed in `layerGroupsRef`.

### Performance Hotspots
- **Terrain cells:** 3,000+ polygons rendered via Canvas renderer. Do NOT recreate on opacity change.
- **Related features:** Now capped at 250 SVG unit radius + partial sort. Was O(n²), now ~O(n log k).
- **D3 particles:** `requestAnimationFrame` loop, pauses when trade routes hidden.

---

## Recommended Next Steps

1. **Mini-map inset** — `leaflet-minimap` or custom overview map
2. **Route travel time estimates** — show days/hours in InfoPanel for trade routes
3. **Search fuzzy matching** — match on etymology/description, not just names
4. **Mobile touch gestures** — pinch-to-measure, long-press for context menu
5. **Export static map** — screenshot API or canvas composite of current view
