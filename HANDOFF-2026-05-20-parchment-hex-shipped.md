# Handoff — Parchment hex styling SHIPPED

**Date:** 2026-05-20
**Author:** Claude (Opus 4.7, 1M context)
**Predecessor:** `HANDOFF-2026-05-19-parchment-hex-styling.md` (closed — the 4-stage plan it described was followed in spirit but substantially redesigned mid-flight; see below).
**Branch:** `master`, synced with `origin/master` at `1b73c84`.
**Working tree:** clean.

---

## TL;DR

The parchment-aged hex map styling shipped. **11 commits** landed on `origin/master`, covering palette tune, per-edge biome boundary strokes (Lever A), sepia italic labels, ocean-blue background, decoupled toggles, and (eventually) a parchment cream baked into each hex polygon's fill rather than a separate base layer.

Two visual audit passes via a Claude Chrome-agent confirmed all targeted fixes work and surfaced no regressions. The MAP-PROMPT.md "hand-drawn parchment fantasy continental map" intent is fulfilled.

This handoff:
- Records what shipped, in commit order
- Captures key design pivots from the predecessor's plan so the next instance doesn't try to revive abandoned approaches
- Names what's deferred and what's a natural next move (R1, regional interactivity, region labels)
- Flags one open cosmetic question (label-position-looks-top-left) that I declined to chase without local repro

---

## What shipped (origin/master tip = `1b73c84`)

```
1b73c84 tune(hex-overlay): warm ochre parchment cream for plateau contrast
842065f tune(hex-overlay): visual-audit-driven contrast & selection fixes
db35ace refactor(hex-overlay): bake parchment into hex polygons, drop base rect
7542987 tune(hex-overlay): soften biome fill + boundary strokes
ff7aeea feat(hex-overlay): decouple biome colors from hex grid visibility
403bb1f fix(app-css): leaflet-container background black → ocean blue
4152304 feat(hex-overlay): sepia-ink labels on parchment (Lever C)
54a7268 feat(hex-overlay): per-edge biome boundary strokes (Lever A)
26e5ba5 feat(hex-grid): tune biome palette toward parchment-context cream
527eeb6 feat(hex-overlay): parchment base layer via SVG feTurbulence pattern
4d7dfce docs(handoff): parchment hex-styling 4-stage ship plan
```

`527eeb6` was reverted in spirit by `db35ace` — it added a full-width feTurbulence parchment base rect, which rendered as a centered "white-fog square" in practice (source-coord rect didn't span the visible Leaflet viewport at typical zoom). The history keeps the archaeology rather than squashing, per user preference at ship time.

**Tests:** 546/546 (added 12 in `54a7268` covering `HEX_EDGE_NEIGHBORS`, `axialKey`, `getNeighborBiomes`). `npx tsc --noEmit` clean. `npm run build` clean.

---

## Key design pivots from the predecessor's plan

The predecessor's handoff inlined Cowork's plan: revised 30-row biome palette + three styling levers (A: per-edge boundary strokes, B: paper-grain pattern overlay, C: sepia ink labels) + the anti-rec on per-edge stroke noise. **Read the predecessor handoff for design rationale; do NOT follow its 4-stage commit order literally.**

What changed mid-flight:

1. **Cowork's "Strokes and fill-alpha over a paper UI" anchor was wrong on its face.** The app UI is dark (`#0a0e15`) with a colored continental schematic SVG (`/veydria-schematic.svg`) as the basemap. There is no parchment UI. This invalidated the load-bearing assumption of Cowork's tuning rule and made Levers B + C non-trivial.

2. **User chose R4 → R2 path** (screenshot first, then parchment base layer between schematic and hex grid). User specifically directed: use SVG `<pattern>` in `<defs>` with feTurbulence + feColorMatrix, NOT raster PNG. Vector-resident.

3. **R2's first implementation (the feTurbulence `<rect>` in `527eeb6`) had four visible symptoms** the user reported after seeing it:
   - White-fog square fog appearing when biome colors toggled on
   - Same-biome hexes rendering non-uniform colors
   - Hexes disappearing on zoom (turned out to be HMR-state confusion, not a real regression — second audit didn't reproduce)
   - Labels partially correct (same caveat — not reproduced on second pass)

4. **`db35ace` was the pivot:** kill the base rect entirely; bake the parchment into the hex polygon fills themselves. Each cell IS a piece of cream paper. The previous "Lever B" from Cowork's plan effectively dissolved into the polygon fill, no separate overlay needed.

5. **`1b73c84` (the final cream-shift to warm ochre)** addressed the "cream-on-cream over the plateau biome zones" caveat. The schematic's H-row Ngaru-Bon plateau is already parchment-toned; neutral cream (`#e8dcc0`) at 0.55 opacity disappeared there. Shifted to `#e4cca0` for hue contrast across the whole map.

**Net architectural state:** parchment is a property of hex polygon fills, not a separate base layer. Lever A (per-edge boundary strokes) is the only Cowork-original lever that survived unchanged in concept. Lever B was absorbed into polygon fills. Lever C (sepia labels) shipped as designed but its legibility depends on the polygon fills under it (not a separate parchment layer).

---

## File map — where the work lives

| File | What it owns |
|---|---|
| `web/src/utils/hex-overlay.ts` | All d3/SVG rendering: parchment fill, polygon, per-edge `<line>` boundary strokes, labels, all highlight-state styling. Module-top constants `PARCHMENT_CREAM`, `PARCHMENT_FILL_OPACITY`, `BIOME_FILL_OPACITY` are the tuning knobs. |
| `web/src/utils/hex-grid.ts:439-477` | `BIOME_COLORS` palette (Cowork-tuned values). |
| `web/src/utils/hex-grid.ts` | Helpers added this session: `HEX_EDGE_NEIGHBORS` (edge-index → axial offset), `axialKey`, `getNeighborBiomes`. Pure functions, fully unit-tested. |
| `web/src/utils/hex-grid.test.ts` | 12 new tests around the helpers above. |
| `web/src/components/MapViewer.tsx` | Toggle effects. The combined-visibility effect (line ~917, "Combined hex-overlay visibility") is the one that decouples Hex Grid ↔ Biome Colors. It runs AFTER the dispatcher effect (`useEffect` at L867) — order matters because the dispatcher fires `hexGridMock.addTo/removeFrom` based on `hex_grid` alone, and the combined effect corrects state by ORing with `biome_colors`. |
| `web/src/App.css:300-321` | `.leaflet-container` background (`#2a4860` ocean blue) and time-of-day filters. |

---

## Tuning knobs (in case you need to retune)

In `web/src/utils/hex-overlay.ts`:

| Constant | Current | What it controls |
|---|---|---|
| `PARCHMENT_CREAM` | `#e4cca0` | Cell fill when biome colors OFF. Warm ochre to contrast with the schematic's parchment-toned plateau areas. |
| `PARCHMENT_FILL_OPACITY` | `0.55` | Cream alpha. Below 0.4 it disappears over the colored basemap. |
| `BIOME_FILL_OPACITY` | `0.3` | Biome alpha. Above 0.4 it muds out the schematic continent shapes; below 0.2 the biomes don't read. |
| `EDGE_BOUNDARY_STROKE` | `rgba(120, 80, 40, 0.85)` | Cross-biome edge color. Dark brown. |
| `EDGE_SEAM_STROKE` | `rgba(212, 168, 84, 0.28)` | Same-biome interior seam color. Faint warm amber. |
| `EDGE_BOUNDARY_WIDTH` | `1.4` | Cross-biome edge weight. |
| `EDGE_SEAM_WIDTH` | `0.35` | Interior seam weight. |
| `LABEL_MIN_ZOOM` | `0` | Below this zoom, labels hide (text too small to read). |

The boundary > seam visual hierarchy is the Catan tile-read effect. The ratio (4× width, 3× alpha) was tuned across two visual audit passes to land where boundaries pop without recreating the "dark brown mesh" problem.

---

## What's verified working (second audit, 2026-05-20)

Confirmed by Claude Chrome-agent visual audit pass:
- Ocean-blue background reads as deep open water
- Hex grid + biome colors toggles work independently (decoupled)
- Cream polygons clearly visible as paper-overlay across all biome regions including the plateau (post-`1b73c84`)
- Biome-boundary strokes clearly heavier than internal seams at any usable zoom (post-`842065f`)
- Selected-hex highlight pops with bold amber fill + thick gold edge (post-`842065f`)
- Sepia italic labels readable at z=0 and above
- Same-biome hexes render uniform color
- Hexes persist across zoom in/out, no flicker
- Time-of-day filters (dawn/dusk/night) still produce legible aesthetic
- Biome OFF after ON cleanly reverts to parchment cream (post-`db35ace` fill-opacity revert fix)

---

## What's open

### Cosmetic (deferred this session)

**"Labels render at top-left of each hex, not centered."** Reported in both audit passes but characterized as cosmetic. The d3 rendering uses `text-anchor: middle` + `dy: 0.35em` + centroid coords from `cell.centroid` — geometrically correct. Without local browser repro, fixing what may not be broken was unwise. Next instance: confirm visually first, then check whether the cell's centroid Y is being flipped twice (`svgY(centroid[1])` is applied in `hex-overlay.ts`; verify the centroid itself isn't already in flipped space).

### Deferred to a future session

- **R1 — rebuild `/veydria-schematic.svg` as outline-only parchment-toned.** The schematic's colored continental shapes still compete with the hex overlay's biome tints. If the user wants the hex layer to be the primary colored layer (full Catan board feel), R1 is the move. Out of scope this session; R2 (parchment via hex polygons) was the chosen alternative.
- **Region-level interactivity** — click a region, see region info panel. Not requested.
- **Region-name labels** (Qollari Highlands, Ndjadi Floodplains, etc.) at high zoom, above the hex grid. Discussed during planning, not in this batch.
- **Sepia label absorption effect** — Cowork's plan suggested a `text-shadow` for "ink soaked into paper" feel. Skipped because CSS `text-shadow` on SVG `<text>` is inconsistent across browsers. If wanted, implement via SVG `<filter>` with `feGaussianBlur` + `feOffset`, or two layered `<text>` elements.

---

## Operational notes for the next instance

- **Multiple stale Vite processes are common** on this machine (ports 5173-5177). Don't kill them blindly — they could be other projects. Let Vite auto-bind the next available port.
- **HMR is reliable** for the cartography app. Hard-refresh (`Ctrl+Shift+R`) clears chunk cache if state feels stale.
- **The decouple effect runs AFTER the dispatcher.** Both wire to `layers` state and React fires effects in declaration order. If you touch either, make sure the combined-visibility effect remains declared after the dispatcher in `MapViewer.tsx`.
- **Highlight states in `applySelectionStyle` bake alpha into their fill rgba**, so they explicitly set `fill-opacity: 1` to avoid double-attenuation. If you add a new highlight state, follow that pattern.
- **The visual-audit-via-Chrome-agent workflow worked well** for this session. Two passes were enough. The prompt template is in this conversation's history; reuse and refine.
- **PixelLab is lapsed and Replicate is cost-sensitive** (per user memory). For any texture asset work, prefer programmatic generation (canvas 2D + noise script) or CC0 textures with license verification. Don't spend on AI image generation without explicit approval.
- **Cowork as cross-review:** the audit-driven design checks landed cleanly in this session. Continue using cross-instance review for design questions where the load-bearing assumption isn't obvious from code.

---

## Push posture for future work

Push only after user visual approval. This session:
- 4d7dfce was committed local-only, pushed today as part of the batch
- 527eeb6...842065f were iterated through several cycles of user feedback + visual audit before push approval
- 1b73c84 + push happened in a single move after the second audit cleared all four targeted fixes

Same posture going forward.

---

## Out of scope this session

- Worldbuilder repo (the parent project). All work was in `veydria-cartography/`.
- Any change to the existing `biome-driven, not faction-driven` palette philosophy.
- New canon entities or lore. Pure visual/UX work.
