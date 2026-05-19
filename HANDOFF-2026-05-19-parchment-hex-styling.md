# Handoff — Parchment-aged hex-grid styling (4-stage ship plan)

**Date:** 2026-05-19
**Author:** Claude Code (Opus 4.7, 1M context)
**Predecessor:** `HANDOFF-2026-05-18-hex-grid-still-broken.md` (closed — Symptom A fixed, Symptom B was never reproducible after cold restart)
**Branch:** `master`, **synced with `origin/master` at `69c8614`** (run `git fetch && git status` to confirm).
**Repo state:** working tree clean.

---

## TL;DR

The hex grid now renders correctly (Symptom A fixed in `69c8614`; Symptom B turned out to be non-reproducible — basin doesn't tint blue on a clean cold-restart). User wants to evolve the look toward "Catan / Risk hand-drawn fantasy hex map" — parchment-aged, biome-driven (NOT faction-driven; Veydria factions are explicitly multipolar/trans-civ and don't tessellate).

A **Cowork instance and the predecessor compared two design angles independently**. Cowork's design won; the predecessor's "region-aggregation via flood-fill" plan was over-engineered. Cowork's plan is **revised palette + three styling levers (A: per-edge boundary strokes, B: paper-grain pattern overlay, C: sepia-ink labels)** plus a sharp anti-recommendation.

This handoff:
- **Inlines Cowork's full deliverable** so it survives sandbox teardown.
- Sets a **4-commit ship order** with rough time estimates.
- Flags **three sanity-checks** the executing instance must resolve before cutting commits (one is structural — Cowork's Lever A implementation hint is slightly wrong; SVG `<polygon>` can't have per-edge stroke widths, needs `<line>`-element redesign).
- Names the **anti-rec** (do NOT add per-edge stroke noise / feTurbulence — it'd break selection/measure/journey state in `applySelectionStyle`).

User wants the new instance to **review/audit, plan, then execute**. Posture is: confirm the design read, write a plan file (this repo has no global plan-mode convention but the executing instance can spec-doc into `web/docs/` or a new handoff), then cut commits one at a time with `npm test && npx tsc --noEmit && npm run build` between each.

---

## State at handoff

### Pushed and live (origin/master = 69c8614)

```
69c8614 fix(map-viewer): re-apply layer visibility on init re-fire
c4edb30 docs(handoff): hex grid partially fixed, two symptoms remain
8a4b253 fix(svg-overlays): select SVG root <g> directly, not g.leaflet-zoom-hide
fc16bfe refactor(map-viewer): remove redundant biome_colors mock; document effect order
0298913 fix(hex-overlay): bump stroke opacity + width so hex outlines are visible
84aaf50 fix(map-viewer): mock overlays (hex_grid, biome_colors) can toggle OFF
```

Plus this handoff doc, committed but not yet pushed.

### What's PROVEN to work post-restart (user-verified)

- Hex grid renders correctly when toggled ON.
- Hex grid stays visible across parent re-renders (Symptom A fix worked).
- Basin renders normal — no blue tint on a clean URL (Symptom B was either stale dev-server cache or the deep-link path firing from a now-cleared URL; either way, not currently reproducible).
- `hexSize 30` produces smaller hexes than `hexSize 70` (correct — hexSize is cell radius).
- `npm test` 534/534 pass; `npx tsc --noEmit` clean; `npm run build` clean.

### Operational

- Cartography dev-server on `localhost:5175` (Vite auto-incremented past 5173/5174). User had FOUR stale Vite processes bound to ports 5173-5176 last session — worth running `netstat -ano | findstr "517"` and killing stale PIDs before testing, to make sure browser sees freshly-bundled JS.
- Worldbuilder map-viewer (unrelated) is on `localhost:5173`.

---

## Design decision — Cowork's plan won

The predecessor's **Move #1 — region detection via flood-fill, unified region paths** was a strict over-engineering of what Cowork's **Lever A — per-edge boundary strokes via neighbor-biome diff** achieves with ~30 lines and no algorithmic complexity. Same Catan tile-read visual outcome, no flood-fill, no path stitching, no refactor of `biomeColorByLabel`, no new SVG layer for region polygons.

**Drop the region-aggregation plan.** Execute Cowork's plan instead.

Cowork's three styling levers + palette compose into a coherent parchment aesthetic that respects:
- Veydria's vision docs (`VEYDRIA-VISION.md`, `MAP-PROMPT.md`) — parchment hand-drawn map, not satellite photo.
- Existing committed palette philosophy (tan/ochre / earthy biome colors at hex-grid.ts:439+).
- Biome-as-stable-coordinate axiom (not faction-as-coordinate — that was ruled out because Veydria factions are multipolar/trans-civ commercial networks, per `factions/00_overview.md`).

---

## Cowork's deliverable (inlined verbatim — Veydria parchment palette, independent read)

> **Anchor.** Strokes (`rgba(212,168,84,0.85)`) and fill-alpha (0.18) over a paper UI are already doing the parchment work. The current palette fights it: several biomes (Cloud forest `#2d5a3d`, Mangrove `#3a6a4a`, Coral reef `#3a8a9a`) are saturated and dark enough to mud out at 18% alpha. Tuning rule applied throughout: pull hue 8–12° toward yellow, drop saturation ~20%, lift value so cells read as tinted paper, not paint chips.

### 1. Revised BIOME_COLORS (current → proposed)

| Biome | Current | Proposed | Rationale (Cowork) |
|---|---|---|---|
| Cloud forest | `#2d5a3d` | `#5e7a4a` | too dark; reads black at 0.18 |
| Highland savanna | `#8faa5c` | `#a8b06a` | less acid |
| Desert | `#d4a76a` | `#d4a76a` | keep — this IS the parchment seam |
| Steppe | `#b8c68e` | `#c4c290` | pulled toward straw |
| Monsoon delta | `#4a7c59` | `#6a8e5e` | "irrigated alluvium", not forest |
| Volcanic archipelago | `#6b4c3a` | `#7a543c` | warmer oxidized basalt |
| Miombo woodland | `#5a7a3a` | `#7a8848` | current reads as algae |
| Afroalpine heath | `#8a9a8a` | `#a6a89a` | warm-neutral |
| River gorge | `#4a6a5a` | `#6a7a6a` | value lift + gray |
| Sabkha | `#c8b890` | `#d8c898` | salt-crust paler than dune |
| Oasis | `#6aaa4a` | `#8aaa5c` | contrast via desat, not pure green |
| Escarpment | `#9a8a6a` | `#a89878` | warmer ochre |
| Highland grassland | `#a0b06a` | `#b4b878` | straw-shift |
| Cliff edge | `#8a8a7a` | `#9c9686` |  |
| River gallery | `#5a8a6a` | `#7a967a` | desat |
| Mangrove swamp | `#3a6a4a` | `#5a7e58` | current goes black at 0.18 |
| Floodplain | `#7a9a5a` | `#94a468` | straw-green for rice-paddy read |
| Stone baray | `#9a9a8a` | `#adaa92` |  |
| Mountain terrace | `#5a7a5a` | `#76886c` |  |
| Fog bank | `#8a9aaa` | `#b0b8be` | was too blue-cold for parchment |
| Cliff road | `#8a7a6a` | `#968474` |  |
| Coral reef | `#3a8a9a` | `#6a9aa4` | poster-blue → pale teal |
| Geothermal vent | `#9a5a3a` | `#a8623c` |  |
| Strait | `#4a7a9a` | `#6a8ea6` |  |
| Sea | `#3a6a9a` | `#6a8ca8` | was ink-spill; "iron-gall blue" framing (poetic — actual iron-gall ink is brown-black) |
| Plains | `#8aaa6a` | `#a4b070` |  |
| Hill | `#9aaa5a` | `#aaa86c` |  |
| Highland | `#a89a6a` | `#a89a6a` | keep (already perfect ochre) |
| Mountain | `#9a8a6a` | `#9a8a6a` | keep |
| Peak | `#b0b0b0` | `#c4beae` | neutral gray reads sterile; warm |

Three biomes kept (Desert, Highland, Mountain); twenty-seven revised. Total covers all 30 entries in `BIOME_COLORS` at `web/src/utils/hex-grid.ts:441-477`.

### 2. Three levers beyond palette

**A. Biome-adjacency boundary strokes.** Today every hex stroke is identical (`hex-overlay.ts` L138–L139, width 1.0). Detect neighbor-biome mismatch and emit a heavier double-stroke (~1.6w, `rgba(150,108,52,0.9)`); internal seams drop to 0.5w @ 0.55. Regions then read as tiles the way a Catan board does, not as a uniform grid drawn over fills. Cowork's implementation hint ("swap fixed stroke-width for a per-edge function") needs a small redesign — see Sanity-Check #1 below.

**B. Paper-grain pattern overlay.** A single tiled fiber/noise PNG in `<defs>` as `<pattern>`, applied via top-layer `<rect>` with `mix-blend-mode: multiply` at 0.06–0.08 opacity. Roughly 30 KB. Turns flat fills into "ink soaked into paper" — the single biggest visual jump per line of code. Implementation: append in the same `hexGroup` init that already wires `cellSel`.

**C. Sepia-ink labels.** Labels are currently `rgba(244,220,160,0.55)` Georgia (`hex-overlay.ts` L139–L141) — that's a dark-UI glow. On parchment, biome-name labels should be sepia ink on warm paper: `rgba(78,52,28,0.78)`, italic, with `text-shadow: 0 0 1px rgba(252,240,210,0.6)` to suggest absorption. Selection / journey highlight states keep their current brighter values for contrast against this baseline.

### 3. Anti-recommendation (DO NOT DO)

> Do not add per-edge stroke noise (`feTurbulence` displacement, `rough.js`, hand-jitter on every polygon). It sounds like the parchment move and is the single most common reason fantasy hex prototypes never ship:
> - (a) it breaks the selection/measure/journey stroke-swaps in `hex-overlay.ts:150-180` because the recognizable polygon edge is gone;
> - (b) the jitter doesn't rescale on zoom, so labels and grids disagree at every zoom level;
> - (c) you can't tell biome boundaries (Lever A) from accidental edge wobble.
>
> Parchment must come from the paper (Lever B) and from region coherence (Lever A). The hexes themselves stay crisp — the paper underneath does the weathering.

---

## Ship plan — 4 commits in order

Each commit is independently testable. You can stop early if a step doesn't pass the visual review.

### Commit 1 — Palette swap (~30 min)

**Scope:** Replace 27 hex values in `BIOME_COLORS` at `web/src/utils/hex-grid.ts:441-477`. Keep the three "→ keep" entries (Desert, Highland, Mountain) unchanged.

**Pre-commit:** Sanity-check #3 below — grep tests for hardcoded color strings.

**Commit message hook:** "tune biome palette toward parchment; Cowork-cross-reviewed"

### Commit 2 — Lever A: per-edge boundary strokes (~1-2 hours, BIGGEST)

**Scope:** Make adjacent hexes with different biomes show a heavier double-stroke between them; same-biome neighbors get a lighter internal seam. This is the Catan tile read.

**Implementation must address Sanity-Check #1** (SVG polygon can't have per-edge stroke widths — design decision required).

**Files:**
- `web/src/utils/hex-overlay.ts` — restructure `rebuild()` to append per-edge `<line>` elements (recommended) or per-region `<path>` (alternative); update `applySelectionStyle` if needed to preserve measure/select/journey highlights.
- `web/src/utils/hex-grid.ts` — may need a small helper to precompute "neighbor biome by edge index" per hex, called once at rebuild time.

**Tests:** add ~5-8 tests covering neighbor-biome diff detection (pure logic; no DOM).

### Commit 3 — Lever B: paper-grain pattern overlay (~30 min)

**Scope:** Add a single tiled noise/fiber pattern in SVG `<defs>`, apply via top-layer `<rect>` with `mix-blend-mode: multiply` at 0.06-0.08 opacity. Spans the SVG bounds (1200×800).

**Asset:** ~30 KB paper-fiber PNG. Either:
- Generate one via the `pixellab` MCP or a simple noise generator (avoid feTurbulence at render time per anti-rec — texture is BAKED).
- Or use a CC0/public-domain paper texture (e.g., from `texturelabs.org` — confirm license).

Place under `web/public/textures/paper-grain.png`. Reference from `hex-overlay.ts` init.

**Files:** `web/src/utils/hex-overlay.ts` (the `hexGroup` init around line 65-69).

### Commit 4 — Lever C: sepia-ink labels (~15 min)

**Scope:** Update the label `<text>` append in `hex-overlay.ts:132-144` — change fill to `rgba(78,52,28,0.78)`, add `font-style: italic`, add `text-shadow` (or SVG equivalent via filter — note: SVG `text-shadow` CSS property works in modern browsers but may render inconsistently; if it's flaky, use a `<filter>` with `feGaussianBlur` + `feOffset` or two `<text>` elements layered for the shadow effect).

**Verify against Sanity-Check #2 first** — Lever C should ship AFTER Lever B if the map background is dark, so labels don't have a window where they're invisible.

**Files:** `web/src/utils/hex-overlay.ts` (label append + measure/select/journey label fills at lines 184-219 stay unchanged — they're the brighter highlight states).

---

## Sanity-checks BEFORE cutting commits

### #1 — Lever A's implementation hint is slightly wrong

SVG `<polygon stroke-width="X">` has a single stroke-width for the entire polygon. You can NOT vary stroke-width per edge on a `<polygon>` element. Cowork's "swap fixed stroke-width for a per-edge function" needs one of two redesigns:

**Option A (recommended) — per-edge `<line>` elements per hex.**
- Make polygons stroke-less (just fills).
- For each hex, append 6 `<line>` children (one per edge), with `stroke-width` and color set based on neighbor biome.
- Selection/measure/journey highlights in `applySelectionStyle` continue to work on the polygon itself for the FILL only; if we want them to also highlight the border, the lines need a `data-edge` selector path.
- DOM size at hexSize=30: ~220 hexes × 6 lines = 1320 `<line>` elements. Fine for SVG.

**Option B — per-region path stitching (Cowork's approach without the polygon).**
- Run a small flood-fill to detect same-biome regions, then emit one `<path>` per region for boundaries.
- This is what the predecessor's "Move #1" did. Reintroducing some of the algorithmic complexity Cowork was trying to avoid.

Recommend Option A. Document the choice in the commit message.

### #2 — Lever C assumes a parchment background

Sepia ink (`rgba(78,52,28,0.78)`) on warm paper = beautiful. Sepia ink on a **dark** map background = invisible. Two situations:

- Map base is already paper-colored / light → Lever C can ship in any order.
- Map base is dark → Lever C MUST ship after Lever B (the paper-grain overlay shifts perceived background toward warm-light), or it'll vanish briefly between commits.

Verify the current background color in `web/src/index.css` / `App.css` / map container style before ordering commits 3 and 4.

### #3 — Palette test pin check

Before swapping 27 colors:

```bash
cd web && grep -rn "#2d5a3d\|#3a6a4a\|#3a8a9a\|#4a7c59\|#6b4c3a\|#5a7a3a\|#3a6a9a\|#b0b0b0" src/
```

If any test asserts a specific hex value from `BIOME_COLORS`, update it in the SAME commit so CI stays green. Likely candidates: `src/utils/hex-grid.test.ts`.

---

## Files in play

| File | Touched by | Risk |
|------|-----------|------|
| `web/src/utils/hex-grid.ts` (BIOME_COLORS) | Commit 1 | low |
| `web/src/utils/hex-grid.ts` (neighbor helper) | Commit 2 (optional) | low |
| `web/src/utils/hex-overlay.ts` (rebuild + edge lines) | Commit 2 | **medium** — touches lifecycle |
| `web/src/utils/hex-overlay.ts` (pattern defs) | Commit 3 | low |
| `web/src/utils/hex-overlay.ts` (label styling) | Commit 4 | low |
| `web/public/textures/paper-grain.png` | Commit 3 (new file) | low |
| `web/src/utils/hex-grid.test.ts` | Commits 1 (if pins exist) + 2 (new tests) | low |
| `web/src/index.css` / global | Commits 3 or 4 (if background needs adjustment for Lever C) | low |

## What NOT to touch

- The six previously-pushed commits (`84aaf50` … `69c8614`). The selector fix, the visibility-toggle dispatcher, and the init self-consistency fix are all load-bearing.
- `hex-overlay.ts:249-262` (`setVisibility`, `setHexSize`) — already correct.
- `applySelectionStyle` (`hex-overlay.ts:150-220`) measure/select/journey FILL colors. These are intentional highlight states. If Lever A's edge lines need their own highlight states (selected hex's edges go gold, etc.), add a separate function for edge styling rather than tangling it into `applySelectionStyle`.
- Risk-style faction tinting. Ruled out — Veydria factions are explicitly multipolar/trans-civ commercial networks, don't tessellate.

---

## Verification posture

Before each commit:

```powershell
cd web
npx tsc --noEmit
npm test --silent
npm run build
```

After each commit (or after each pair, if bundling):

1. **Cold restart** the dev server if visual debugging starts feeling weird:
   ```powershell
   netstat -ano | findstr "517"       # see PIDs
   # kill stale Vite PIDs as needed
   cd web ; npm run dev
   ```
2. Hard-refresh browser on the freshly-restarted port (likely 5173 if you killed stales, else whatever Vite picks).
3. Toggle Hex Grid ON, toggle Biome Colors ON. Visual check.
4. Pan / zoom / change hexSize (30 / 50 / 70). Confirm nothing regresses.
5. Click hexes, run measure-mode (click two hexes), confirm selection/measure/journey highlights still read correctly against the new palette and (after Commit 2) the new border styling.

## Push posture

**Do not push until the user has visually approved the result.** Same posture as the predecessor sessions. Land each commit locally, let the user eyeball the dev server, then push the batch when they're satisfied.

If the user wants to ship in stages (e.g., push after Commit 1 to see Cowork's palette in production before doing the borders), they'll say so explicitly.

---

## Open questions for the executor to resolve with the user

1. **Texture asset for Lever B** — generate one locally (pixellab MCP / programmatic noise) or grab a CC0 paper texture? User has had cost issues with PixelLab before (see project memory). A 30 KB tiled noise texture can be generated programmatically in ~20 lines of canvas code, no AI needed. Recommend that path.
2. **Stage 2 alternative (Option A vs B in Sanity-Check #1)** — recommend Option A (per-edge `<line>` elements). User likely doesn't need to weigh in unless they have a strong opinion on DOM weight.
3. **Background color for Lever C** — depends on what the current global CSS does. Read `web/src/index.css` and the App layout's background before assuming.

## Out of scope this session

- Region-level interactivity (click a region, see region info). Not requested.
- Region-name labels (Qollari Highlands, Ndjadi Floodplains) above the hex grid at high zoom. Discussed as a potential future move; not in this batch.
- Any change to the existing palette philosophy of "biome-driven, not faction-driven."
- Worldbuilder repo (the parent project). All work this session is in `veydria-cartography/`.
