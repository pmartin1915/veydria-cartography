# Session Handoff — 2026-05-11 · QoL Polish: Scrollers, Zoom, Transitions

## Branch
`master`  
Head: `0bd03ce` + uncommitted work below  
Status: **clean working tree intended after commit**

## Verification
- `npm test -- --run` (web): **391/391 pass** across 23 test files
- `npm run build` (web): ✅ green (index.js ~421 kB, CSS ~98 kB)
- `python pipeline.py validate` (generator): ✅ green

## Commit (intended)

```
qol: smoother scrollbars, zoom, and transitions
```

## Summary of work delivered

### 1. Smoother zooming (MapViewer.tsx)
Tuned Leaflet interaction defaults for a less janky feel:
- `zoomDelta: 0.5` (was `1`) — zoom buttons now step in half-increments, matching `zoomSnap`
- `wheelPxPerZoomLevel: 180` (was `120`) — mouse wheel is less sensitive, scrolls feel more controlled
- `bounceAtZoomLimits: false` — removes the elastic bounce when hitting min/max zoom

### 2. Scrollbar + scroll behavior polish (App.css)
**Firefox support:**
- Added `scrollbar-width: thin` and `scrollbar-color` to the global `*` selector so Firefox gets the same slim dark scrollbars as WebKit

**Overscroll containment:**
Added `overscroll-behavior: contain` to every scrollable panel so scrolling past the top/bottom doesn't accidentally zoom or pan the map underneath:
- `.layer-controls`
- `.info-panel`
- `.search-results`
- `.journey-planner-body`
- `.journey-dropdown-list`
- `.keyboard-help-body`
- `.journey-history-list`
- `.hex-info-panel` (mobile)

**iOS momentum scrolling:**
Added `-webkit-overflow-scrolling: touch` to all of the above for native momentum on iOS Safari.

**Smooth scroll:**
Added `scroll-behavior: smooth` to the main scrollable containers for keyboard/navigation driven scrolls.

### 3. Toast exit animations (App.tsx + new `useToast` hook)
**New file:** `web/src/utils/use-toast.ts`
- Manages `[message, leaving, show]` state
- After the visible duration expires, sets `leaving: true` for 200ms so CSS can play the exit animation, then fully unmounts
- Calling `show()` while a toast is already visible cancels pending timers and replaces the message immediately

**App.tsx refactored:**
Replaced 4 separate `useState` + `useRef` toast patterns with:
```tsx
const [shareToast, shareToastLeaving, showShareToast] = useToast(2000)
const [patchToast, patchToastLeaving, showPatchToast] = useToast(3000)
const [annotationToast, annotationToastLeaving, showAnnotationToast] = useToast(2000)
const [logToast, logToastLeaving, showLogToast] = useToast(2000)
```

**CSS exit animations:**
- `.toast-notification.exiting` → `toastOut` keyframe (fade + slight downward drift)
- `.search-overlay.exiting` + `.search-modal.exiting` → `fadeOut` + `scaleOut` keyframes (foundation for future overlay exit wiring)

### 4. HexInfoPanel desktop entrance animation
Added `hexPanelIn` keyframe (fade + slight downward slide) to `.hex-info-panel` on desktop. Mobile already had `hexPanelInMobile`; now both have entrance motion.

### 5. Accessibility & motion preferences
**Focus-visible:**
Global `:focus-visible` styles with `outline: 2px solid var(--text-accent)` and `outline-offset: 2px`. `:focus:not(:focus-visible)` removes the default outline so mouse users don't see rings, keyboard users do.

**Reduced motion:**
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  .leaflet-container { transition: none !important; }
  .loading-compass, .loading-glow { animation: none !important; }
}
```

### 6. Transition curve polish
Updated `--transition-fast` from `150ms ease` to `150ms cubic-bezier(0.4, 0, 0.2, 1)` for a slightly snappier, more modern feel. Added `--transition-spring: 400ms cubic-bezier(0.34, 1.56, 0.64, 1)` for future bouncy interactions.

## Files touched

```
web/src/components/MapViewer.tsx          zoomDelta, wheelPxPerZoomLevel, bounceAtZoomLimits
web/src/utils/use-toast.ts               NEW — animated toast hook
web/src/App.tsx                          4 toasts refactored to useToast
web/src/App.css                          scrollbar, overscroll, toastOut, scaleOut, hexPanelIn,
                                         focus-visible, prefers-reduced-motion, transition curves
```

## Notes for the next instance
- **Search overlay exit CSS is prepared but not wired.** `.search-overlay.exiting` and `.search-modal.exiting` exist in App.css. To use them, the `SearchBar` (or a wrapper in App.tsx) would need to stay mounted for ~120ms after `searchOpen` becomes false, similar to how `useToast` handles toast exit.
- **No new localStorage keys or schema bumps** this session.
- **Bundle size:** CSS grew from ~86 kB to ~98 kB (mostly from new animation keyframes and focus-visible rules). Still well under any threshold.
- **CI remains manual:** verify `npm test -- --run` and `python pipeline.py validate` before merge.
