# Handoff — 2026-05-10 — Dedicated Mobile Player Mode

## Branch

`auto/season-nothing-beats-2026-05-10`

## State of the tree

- Clean working tree
- Commit: `6221dbb` — feat: dedicated mobile player mode
- Parent: `2c80ede` — feat: time-of-day overlay
- 328/328 tests pass (21 files)
- `tsc --noEmit` clean
- `vite build` green
- `pipeline.py validate` green

## What was shipped

**Dedicated mobile player mode** — the backlog item "share-mode URL renders cleanly on phone with no editing, just panning, info panels, and journey path."

### Behaviour

When a user opens a `#share=1` URL on a viewport ≤768px:

- The full GM header (Journey, Pin, Measure, Hex, Share, Snapshot, Player Link, Graph, Log, Time-of-day, Help, Search buttons) is **completely hidden**
- A minimal floating chrome replaces it:
  - **Title pill** ("VEYDRIA") top-left — branding only, no interaction
  - **Actions pill** top-right with three buttons:
    - 🔍 Search — opens the Cmd-K palette
    - ? Help — opens keyboard shortcuts overlay
    - **GM** — exits player view (strips `share=1` from hash and reloads)
- The map fills the **entire screen** (`100dvh`) — no header padding
- The existing **layer launcher pill** stays at bottom-left (players can toggle layers if the GM left them on)
- **InfoPanel** and **HexInfoPanel** still open as bottom sheets on tap
- **JourneyPlanner** still opens as a bottom sheet if `journeyFrom` + `journeyTo` are in the URL
- All editing functionality remains hidden (annotations, encounters, edit mode, pins, measure)

### Files changed

| File | Change |
|---|---|
| `web/src/utils/media-query.ts` | New `useMediaQuery(query)` hook — SSR-safe, returns boolean, auto-updates on viewport changes |
| `web/src/utils/media-query.test.ts` | 6 tests: initial state, match/no-match, updates on change, cleanup, SSR guard, query re-registration |
| `web/src/App.tsx` | Added `isMobile` via `useMediaQuery`, `mobilePlayerMode = shareMode && isMobile`, `handleExitPlayerView`, conditional render of minimal chrome vs full header |
| `web/src/App.css` | `.mobile-player-mode` layout (full-screen map), `.mobile-player-chrome` / `.mobile-player-pill` / `.mobile-player-btn` styles |
| `web/package.json` | Added `@testing-library/react` dev dependency (needed for hook tests in happy-dom env) |

### Design decisions

1. **Why a reload for exit?** Player mode and GM mode have fundamentally different render trees. A reload is the cleanest way to switch — no state sync headaches.
2. **Why keep Search?** Players need to find features. It's the most-used interaction after pan/zoom/tap.
3. **Why keep Help?** Keyboard shortcuts (pan, zoom, etc.) are still relevant in player mode.
4. **Why keep the layer launcher?** The GM might share a URL with specific layers on. Players should be able to toggle them off if they're in the way.
5. **Pointer-events pattern:** The chrome container is `pointer-events: none`, buttons are `pointer-events: auto` — clicks pass through empty space to the map.

## Verification

```bash
cd web
npm test        # 328 pass
npx tsc --noEmit # clean
npm run build    # green
```

## Next priority

From MASTER.md backlog:

- **Multi-route comparison** *(medium)* — overlay Direct vs Safest vs Cheapest routes simultaneously with distinct colours and side-by-side stat blocks.
- **Time / calendar layer** *(medium)* — overlay civilizational calendar dates on the journey breakdown. Pulls from worldbuilder's calendar YAML.
- **Static map regeneration** *(large)* — "Render this view as parchment" button that hands layer state to the Python pipeline and produces a high-DPI PNG.

The manual mobile audit is still in "In Progress / Next" but requires real-device verification.
