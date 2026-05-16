# Handoff — Mobile Audit (code-level)

**Date:** 2026-05-15
**Branch:** main
**Tests:** 489/489 pass (27 files)
**Build:** green (~470 kB JS, ~113 kB CSS)
**Python validation:** green

## What was checked

Since I can't hold a physical device, this was a **code-level mobile audit** focusing on responsive CSS, touch event handling, and iOS-specific polish.

### Checked

- **Viewport meta tag**: `100dvh` root, `invalidateSize` on resize/orientationchange ✓
- **Touch event gating**: `L.Browser.mobile` guards on mousemove/mouseout in MapViewer ✓
- **Bottom-sheet behaviour**: InfoPanel, HexInfoPanel, JourneyPlanner all have mobile bottom-sheet CSS ✓
- **Header overflow**: `.header-right` scrolls horizontally on mobile, hiding scrollbar ✓
- **Mobile player mode**: Floating pills replace full header; layer launcher stays visible ✓
- **Session HUD mobile**: 30px height, smaller chips, horizontal scroll ✓
- **Parchment button**: Hidden in share mode; header scrolls on mobile ✓
- **New features (hex prep + static map)**: Responsive styles present or inherited ✓

### Fixed

**iOS momentum scrolling** (`-webkit-overflow-scrolling: touch`) was missing from several scrollable containers. On iOS Safari this makes scroll feel native instead of janky. Added to:
- `.session-hud-scroll`
- `.header-right` (mobile)
- `.journey-tabs` (mobile)
- `.layer-controls` (mobile)
- `.search-results`
- `.info-panel-body`

### Not checked (requires real device)

- Pinch-zoom smoothness
- Bottom-sheet contention when multiple panels open simultaneously
- Hex measure endpoint visibility on phone
- Label tint at label-visible zoom levels
- Session HUD chip tap targets (20px tall on mobile — below 44px HIG)
- 36px tap targets on all interactive elements

## Verification

```bash
cd web && npm test -- --run        # 489/489 pass
cd web && npm run build             # green
cd generator && python pipeline.py validate  # green
```

## Next plausible moves

- **Real-device mobile audit** when you have a phone handy — focus on pinch-zoom, bottom-sheet stacking, and the 20px Session HUD chips.
- **Worldbuilder upstream** — biome words + relationships (out of this repo's reach).
