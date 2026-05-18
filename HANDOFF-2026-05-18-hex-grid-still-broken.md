# Handoff — Hex grid partially fixed; two new symptoms remain

**Date:** 2026-05-18
**Author:** Claude Code (Opus 4.7, 1M context)
**Predecessor:** worldbuilder/HANDOFF-2026-05-18-deep-link-contract-closed.md
**Branch:** `master` on `veydria-cartography`, 4 commits ahead of `origin/master`, **NOT pushed**

---

## TL;DR

WARN-1 ("Hex Grid layer doesn't render even when toggled on") had a root cause hiding under three second-order bugs. Four commits in this branch fix the second-order bugs AND the root cause. **Trade routes now render correctly — that proves the root-cause fix worked.** But the hex grid itself still misbehaves: it appears for ~half a second then disappears, and turns the basin and some other features blue + translucent. Both symptoms surfaced only after the SVG selector fix in `8a4b253` actually made the layer reachable.

User asked for a handoff because I'm out of diagnostic options without browser access. Plan agent should pick this up.

---

## What's committed locally (NOT pushed)

```
8a4b253 fix(svg-overlays): select SVG root <g> directly, not g.leaflet-zoom-hide
fc16bfe refactor(map-viewer): remove redundant biome_colors mock; document effect order
0298913 fix(hex-overlay): bump stroke opacity + width so hex outlines are visible
84aaf50 fix(map-viewer): mock overlays (hex_grid, biome_colors) can toggle OFF
4033278 fix(deep-link): strip ?focus= from URL even when value is rejected   ← already on origin
```

All four local commits passed: `npm test` (534 passing, 9 new), `npx tsc --noEmit`, `npm run build`.

The commits are independent and all real fixes. None should be reverted unless we discover a new bug they introduced. They are:

- **`84aaf50`** — visibility-toggle dispatcher was casting mocks to `L.LayerGroup` and calling `map.hasLayer(mock)` / `map.removeLayer(mock)`, both no-ops. So `hex_grid` and `biome_colors` (mock-shaped overlays) could be toggled ON but never OFF. Extracted `applyLayerVisibility` into `web/src/utils/layer-visibility.ts` with a `__mock: true` discriminator; 9 regression tests.
- **`0298913`** — bumped hex stroke 0.45→0.85 opacity, 0.6→1.0 width, fill 0.04→0.06, plus highlight strokes raised to preserve the visual hierarchy. (Originally proposed as the WARN-1 fix; turned out to be necessary but insufficient.)
- **`fc16bfe`** — removed redundant `biome_colors` mock from `layerGroupsRef` (its dedicated `useEffect` at MapViewer.tsx:902-905 is the canonical path; mock was double-firing). Added "do not reorder" comment on the `terrain_cost` / `faction_control` effect ordering.
- **`8a4b253`** ← **the actual WARN-1 root cause.** Both `hex-overlay.ts:61` and `d3-overlay.ts:33` selected `g.leaflet-zoom-hide` against the SVG returned by `L.svg().addTo(map)`. In Leaflet 1.9, that class is only added to `panes.markerPane` and `panes.shadowPane` — **never** to a `<g>` inside an SVG renderer. The selector matched nothing, `.append('g')` on the empty d3 selection silently no-op'd, and neither `g.hex-grid-group` nor `g.d3-route-group` was ever created in the DOM. Fix selects the SVG root `<g>` directly.

User confirmed post-restart: **trade routes now render**, so the selector fix works for d3-overlay. Hex overlay was created too (DOM diagnostic showed `groupExists: true` briefly, then went away — user described as "saw it for half a second").

---

## Outstanding symptoms

Both observed by user after a clean dev-server restart on `localhost:5174` with the latest commit `8a4b253` checked out:

### Symptom A — Hex grid flashes for ~half a second then disappears

When Hex Grid is toggled ON (LayerControls "orange dot is active, cell size 30"), the user sees the hex outlines briefly, then they vanish. The LayerControls toggle stays ON.

Hypotheses (in order of suspicion):

1. **A subsequent `useEffect` is calling `setVisibility(false)` or rebuilding the group with bad state.** Candidates that touch `hexOverlayRef.current` post-init:
   - `MapViewer.tsx:902` — `setBiomeColorsEnabled(layers.biome_colors)` (dedicated effect; shouldn't hide)
   - `MapViewer.tsx:943` — `setHexSize(hexSize)` (rebuild path; user has hexSize=30, default is 50, so this fires on mount; rebuild clears all `g.hex-cell` and recreates them — *should* re-populate but may be where the flash comes from)
   - `MapViewer.tsx:950` — `setSelectedLabel`
   - `MapViewer.tsx:956` — `setMeasurePath`
   - `MapViewer.tsx:962` — `setJourneyRoute`
2. **The visibility-toggle effect is firing twice with conflicting state.** My `applyLayerVisibility` calls `mock.addTo()` / `mock.removeFrom()` unconditionally on every `layers`/`zoomLevel` change. If something briefly sets `layers.hex_grid = false`, the layer hides. Could be: a `setLayers` call in a different effect / handler that flips it off; or a stale `layers` closure.
3. **`setHexSize` race.** The user changed hexSize to 30. On mount: map-init effect creates `hexOverlay` at default size 50. Then the `[hexSize]` effect fires, calls `setHexSize(30)` → `rebuild(30)`. `rebuild` calls `hexGroup.selectAll('g.hex-cell').remove()` then re-appends. Then `setHexSize` wraps with `hexGroup.style('display', isVisible ? 'block' : 'none')`. At the moment `rebuild` runs, `isVisible` could be stale — that's a closure-over-`let` variable inside `initHexOverlay`. The closure captures `isVisible` correctly because it's a `let` in the same scope, but if rebuild's `applySelectionStyle` somehow clears something...
4. **HMR drift, again.** The dev server is now on its third restart since session start. Worth ruling out with one more truly-cold restart (kill all node processes, fresh `npm run dev`).

### Symptom B — Basin turns blue + translucent

User: "It turned the basin and some other things blue and translucent". The basin is the water-layer feature. After enabling Hex Grid, water-area features show as blue + translucent.

Hypotheses (in order of suspicion):

1. **Measure path / measure endpoint highlights are firing on basin hexes.** Those strokes are deliberately blue: `rgba(186, 226, 244, 0.95)` (endpoints) and `rgba(160, 212, 232, 0.9)` (mid-path) in `hex-overlay.ts:151-153`. If `measurePathSet` or `measureEndpoints` is non-empty at mount, hexes covering the basin would get blue strokes. Check whether `hexMeasureMode` / `hexMeasurePath` props are accidentally non-null at first render — possibly a deep-link side-effect.
2. **Journey route auto-painted.** Journey route gets the gold `rgba(232, 184, 96, 0.9)` stroke. NOT blue. So unlikely.
3. **`biome_colors` got enabled.** Check `LayerControls` for whether "Biome Colors" toggle is active. The biome palette (`BIOME_COLORS` in `hex-grid.ts:439-`) has no truly blue entries — closest is `'Monsoon delta': '#4a7c59'` (greenish). So biome colors alone shouldn't produce blue. BUT — biome colors are applied as `fill`, not `stroke`. If the underlying water polygon is blue and the biome fill is greenish at 18% opacity, the visible color could read as blue-green.
4. **Render order.** The hex-grid SVG group is now appended to the same `<g>` root as other Leaflet vector layers (the water polygon is also SVG). Multiple `<g>` siblings render in document order — last sibling on top. If hex-grid renders BELOW water, water's fill covers the hex outlines. But the user reports SEEING blue translucency, so it's not "hex grid is hidden by water" — more likely the hex grid is on top and its fill is interacting with the water layer's fill compositing.

### What I'd try next

If picking this up cold, in order:

1. **Truly cold restart.** Kill all running node processes (`taskkill /F /IM node.exe` on Windows, watching for unrelated processes), restart `npm run dev` from `web/`, hard-refresh browser. Re-run the same diagnostic from above to confirm `groupExists: true` and `cellCount: ~220` (at hexSize 30 over the 1200×800 map).

2. **Run this diagnostic AFTER toggling Hex Grid ON and waiting for the "disappearance":**

   ```js
   (() => {
     const g = document.querySelector('.hex-grid-group');
     const cells = g?.querySelectorAll('g.hex-cell') ?? [];
     const sample = cells[0];
     const polygon = sample?.querySelector('polygon');
     const text = sample?.querySelector('text');
     const cs = polygon && getComputedStyle(polygon);
     return {
       groupExists: !!g,
       groupDisplay: g && getComputedStyle(g).display,
       groupOpacity: g && getComputedStyle(g).opacity,
       cellCount: cells.length,
       polygonFill: cs?.fill,
       polygonFillOpacity: cs?.fillOpacity,
       polygonStroke: cs?.stroke,
       polygonStrokeOpacity: cs?.strokeOpacity,
       sampleLabel: text?.textContent,
       blueHexCount: Array.from(cells).filter(c => {
         const p = c.querySelector('polygon');
         const s = p && getComputedStyle(p).stroke;
         return s && /\b(186, 226, 244|160, 212, 232|66, 165, 245|0,\s*0,\s*255)\b/.test(s);
       }).length,
     };
   })();
   ```

   This tells you: did the group really disappear (groupExists vs groupDisplay='none'), how many hexes are styled blue (blueHexCount), and what the default polygon looks like.

3. **Add a temporary console.log to `setVisibility` to trace every call.** In `web/src/utils/hex-overlay.ts`:

   ```ts
   setVisibility: (visible: boolean) => {
     console.log('[hex-overlay] setVisibility', visible, new Error().stack?.split('\n').slice(1, 5).join('\n'))
     isVisible = visible
     hexGroup.style('display', visible ? 'block' : 'none')
     if (visible) applyZoomLabels()
   },
   ```

   With this, the browser console will print every call to setVisibility plus the call stack. Will tell you if something is calling setVisibility(false) right after the user's setVisibility(true).

4. **Check `hexMeasureMode` / `hexMeasurePath` props at first render.** These are passed to MapViewer from App. If App is starting in hex-measure mode somehow (URL deep-link, stuck state from a previous session), measure-path styles will be active on certain hexes. The blue strokes come from there.

5. **If symptom B turns out to be biome colors + water fill compositing**, that's a styling decision — talk to user before changing. Could be solved by making the hex polygon fill render-mode change (e.g., `mix-blend-mode` or `paint-order`) but that's design territory.

### What I have NOT tried

- Adding diagnostic logging to the codebase. The plan agent should consider this as a first step.
- Inspecting render order in the SVG DOM.
- Checking whether any `setLayers({hex_grid: false})` exists anywhere.
- Looking at `hexMeasureMode` initial state in App.tsx.

---

## Operational state for next instance

**Dev server:** cartography on `localhost:5174` (user-managed). Worldbuilder map-viewer on `localhost:5173` (unrelated to this work).

**Commits to push** once the symptoms are resolved: 4 commits on `master` in `veydria-cartography`. None are wrong; the only reason they're not pushed is the predecessor's posture ("do not push without user OK"). Push them as one batch.

**Don't amend.** Same posture as the predecessor — if a follow-up fix is needed, create a new commit.

**Do not modify the four committed files casually** — they are:
- `web/src/components/MapViewer.tsx` (toggle dispatcher refactor, biome_colors mock removed, ordering comment)
- `web/src/utils/hex-overlay.ts` (selector fix, styling bumps, no behavior change in destroy/init lifecycle)
- `web/src/utils/d3-overlay.ts` (selector fix only)
- `web/src/utils/layer-visibility.ts` + `.test.ts` (new files)

If the symptoms are caused by something the four commits introduced, the diff to investigate first is `0298913` (styling values — bumped highlight stroke widths could conceivably interact with the measure-path branch differently than before).

---

## What's still PROVEN to work post-this-session

- Trade routes render (post-restart, per user verification).
- Toggle-off for hex_grid and biome_colors mocks correctly fires `setVisibility(false)` (per regression tests).
- `npm test` passes 534/534.
- `npx tsc --noEmit` clean.
- `npm run build` clean.

The bugs left are runtime / browser-only.
