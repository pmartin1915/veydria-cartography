# Handoff — 2026-05-09 (round 3): hex deep-link + distance mode

*Continues from `HANDOFF-2026-05-09-zoom-and-hex-polish.md`. That doc queued five candidate moves (small → larger). This session shipped the smallest two and the medium-scope one (hex-distance), plus added a Tactical preset that pairs with it.*

## State at close

- Branch `master`, all five commits committed locally. **Not pushed.**
- Tests: **101/101 pass** (was 84 at start of `HANDOFF-2026-05-09`, then 91 after deep-link, 100 after distance math, 101 after Tactical preset).
- Build: `tsc -b && vite build`. Main bundle **335.25 kB / 103.10 kB gzip** (was 331 / 102 at this session's open — +4 kB raw / +1 kB gzip across all five commits).
- TypeScript clean (`npx tsc --noEmit`).
- Working tree clean apart from `.claude/` (unrelated, untracked).

## What landed this session (oldest → newest)

| SHA | Title |
|---|---|
| `169c1db` | feat(hex-grid): deep-link selected hex via URL hash |
| `ce657a5` | feat(hex-grid): "Centre on hex" button in HexInfoPanel |
| `ae439b1` | feat(hex-grid): axialDistance + hexLineBetween |
| `22206a7` | feat(hex-grid): hex-distance measurement mode |
| `24d0cf9` | feat(layer-presets): "Tactical" preset (hex grid prominent, terrain dimmed) |

### Deep-link a hex (`169c1db`)

`#hex=G7` in the URL hash now restores the selection on load: turns the hex_grid layer on, flies to the centroid, opens HexInfoPanel.

- `web/src/utils/url-hash.ts` — added `hexLabel` field to `ViewportState`. `parseHash` validates labels with `/^[A-Z]+\d+$/` so malformed values are dropped instead of silently selecting nothing later. `buildHash` writes `hex=<label>` after `feature=`.
- `web/src/utils/hex-overlay.ts` — added `getHexByLabel(label)` to the `HexOverlay` interface. Linear scan over `cells` (≤ ~600 cells even at the smallest hex size, called only on deep-link resolution).
- `web/src/components/MapViewer.tsx` — added `selectHexByLabel(label)` to the imperative handle. Resolves the label, fires `onSelectHex`, flies to the hex centroid.
- `web/src/App.tsx` — on initial load, if `hashState.hexLabel` is set, ensures `layers.hex_grid` is on and calls `mapRef.current?.selectHexByLabel(hexLabel)` after a delay (700 ms alone, 1100 ms when feature also present so the feature fly settles first).
- **Mutual exclusion**: feature and hex selections are mutually exclusive in the URL hash, matching the on-screen "single bottom sheet" rule. `handleFeatureClick`, `handleSearchSelect`, `handleSelectFeatureById`, and the `InfoPanel` `onSelectFeature` all clear `hexLabel` when they set `featureId`. The `onSelectHex` callback clears `featureId` when it sets `hexLabel`.
- 7 new tests in `web/src/utils/url-hash.test.ts` (new file): valid labels (`G7`, `AA12`), malformed rejection (lowercase, no digits, URL-encoded space), round-trip with zoom/center, builder omits `hex=` when absent.

### "Centre on hex" button (`ce657a5`)

A ⊙ button in `HexInfoPanel` header next to close. Re-flies the camera to the selected hex without re-firing the select callback (the hex is already selected). Distinct from `selectHexByLabel`.

- `flyToHex(label)` added to MapViewer's imperative handle. Same lookup as `selectHexByLabel` but no callback fire and shorter duration (0.6 s vs 1.0 s).
- `HexInfoPanel` takes an optional `onCentre` prop; renders the button only when supplied.
- New `.hex-info-panel-actions` flex container in `App.css` so the centre + close buttons sit together.

### Distance math (`ae439b1`)

`axialDistance(a, b)` and `hexLineBetween(a, b)` in `hex-grid.ts`. Pure functions; no overlay dependency. Foundation for the measurement UI in the next commit and any future per-hex routing.

- `axialDistance`: cube formula `(|dq| + |dr| + |dq+dr|) / 2`.
- `hexLineBetween`: linear interpolation in axial space + `roundAxial` per step. Returns `[a]` when `a == b`, otherwise `distance + 1` cells where each consecutive pair are neighbours.
- 9 tests cover identity, neighbour-distance, symmetry, triangle inequality, known coord pair, line endpoints, length = distance + 1, every consecutive step is a neighbour.

### Hex-distance measurement mode (`22206a7`)

Two-click flow on the map: click hex A → click hex B → see the line of cells highlighted with a hex count. Third click resets to the new start hex.

- New trigger button "Hex" in the header next to "Measure" (hexagon SVG glyph).
- New mode state `hexMeasureMode` and endpoint state `hexMeasurePoints: AxialCoord[]` (capped at 2 by the click-handler logic).
- **Click branching**: when `hexMeasureMode` is on, `onSelectHex` adds the hex coord to `hexMeasurePoints` instead of opening the panel / writing the hash. App-side branch — no MapViewer click logic changes.
- **Path rendering**: derived `hexMeasurePath: string[] | null` (computed from `hexLineBetween(...).map(labelHex)` when 2 points, single label when 1, `null` when 0). Passed to MapViewer as a prop, wired to `HexOverlay.setMeasurePath`.
- `HexOverlay.setMeasurePath(labels: string[] | null)` — paints endpoint cells in cyan (`rgba(126, 196, 230, 0.34)` fill, brighter stroke) and mid-path cells in lighter cyan. Style priority order in `applySelectionStyle()` is endpoint > selectedLabel > mid-path > default, so a deep-linked gold selection survives even if it falls inside a measure path.
- **Mutual exclusion**: turning Hex Measure on clears `selectedHex` and turns off `measureMode`, `pinMode`, `journeyMode`. Auto-enables `hex_grid` layer if off. The other three mode toggles (Measure, Pin, Journey) and the Esc handler all clear `hexMeasureMode`.
- Stats panel mirrors the existing measure panel style: shows endpoint labels (`G7 → ?` then `G7 → K12`), distance count, Clear and Done buttons. Placed adjacent to the existing measure panel render block.

No new tests for the UI plumbing — the `axialDistance` / `hexLineBetween` math is fully covered by the prior commit, and the click branching / mutual-exclusion logic is straightforward state plumbing.

### Tactical preset (`24d0cf9`)

A built-in preset that pairs naturally with the hex distance mode: hex grid at 0.9 opacity, terrain_cell dimmed to 0.3, navigation features on (water/river/port/oasis/chokepoint/landmark), politics + trade + story layers off.

One new test asserts intent: `hex_grid` more prominent than `terrain_cell`, civ/trade/faction off. The existing "every built-in preset covers every schema key" test continues to pass against the new preset.

## Architecture deltas worth knowing

### `HexOverlay` now has three style channels

Previously: default + `selectedLabel`. Now: default, `selectedLabel`, `measurePathSet`, `measureEndpoints`. Priority is endpoint > selected > mid-path > default. All four channels are re-evaluated in a single pass through `applySelectionStyle()`, which is cheap (just attribute writes against polygons keyed by `data-label`). No tween / animation; transitions are instant.

`measurePathSet` and `measureEndpoints` are mutated in place by `setMeasurePath`. They survive `setHexSize` because `rebuild` calls `applySelectionStyle()` after generating the new polygons. They are cleared by `setMeasurePath(null)` (e.g., when the user exits hex measure mode or clears endpoints).

### URL hash — feature/hex are mutually exclusive

The hash format now has both `feature=<id>` and `hex=<label>`, but the App enforces mutual exclusion: any code path that sets one clears the other. The pure data layer (`buildHash`) does NOT enforce this — that's the App's job, and the test in `url-hash.test.ts` documents this with a "coexists at the data layer, App enforces" case.

If a future caller sets both in the hash externally (e.g., a user pasting a manually-crafted URL), the resolution order is: feature first, hex second after a 1100 ms delay. The hex select wins because it closes the InfoPanel. Acceptable.

### `MapViewerHandle` interface vs the inline App ref type

`MapViewerHandle` is exported from `MapViewer.tsx` and used internally by the `forwardRef` declaration. `App.tsx` still duplicates a structural type inline at the `useRef` declaration (line ~127 — not the cleanest). When extending the imperative API in the future, **both** need to be updated. This handoff added `selectHexByLabel` and `flyToHex` to both. A small refactor opportunity: import `MapViewerHandle` in `App.tsx` and use it for the ref type. Not done here to keep diffs focused.

### Mode mutual-exclusion graph (after this session)

```
measureMode    pinMode    journeyMode    hexMeasureMode
     │            │            │              │
     └─ on ──> turns off pinMode + hexMeasureMode
                  │            │              │
                  └─ on ──> turns off measureMode + journeyMode + hexMeasureMode
                               │              │
                               └─ on ──> turns off pinMode + hexMeasureMode
                                              │
                                              └─ on ──> turns off measureMode + pinMode + journeyMode + selectedHex
```

Every mode toggle now also handles `hexMeasureMode`. Esc clears all four.

## What's still open

### From the previous handoff

- **#1 Manual mobile audit** — still pending. Code paths intact, but real-device verification has not been done. Verify checklist preserved in the previous handoff (lines 90–96). The new behaviours from *this* session that need a phone walk:
  - [ ] First-load `#hex=G7` URL: continent zooms in, hex grid layer on, hex highlighted in gold, panel slides up.
  - [ ] Tapping the ⊙ centre button while panned away: camera flies back to the selected hex; selection persists.
  - [ ] Toggling Hex Measure on phone: hex grid auto-enables; tapping two cells shows the path; tapping a third resets.
  - [ ] Switching from Hex Measure to Journey clears the cyan path; switching back doesn't restore it (expected).
- **Real biome words** — still upstream-blocked (worldbuilder edit + `npm run sync:data`).
- **Faction graph relationships** — still upstream-blocked (same).

### New gaps introduced or noticed this session

- **Hex Measure on mobile** uses MapViewer's existing flyToBounds-on-tap path, so picking the second endpoint will fly to *that* endpoint and the first one falls off-screen. UX is OK on desktop, awkward on phone. To fix: extend MapViewer with a hexClickMode prop (or pass `hexMeasureMode` directly) and gate the mobile fly-to on it. Or, when the second endpoint lands, fitBounds to both.
- **No keyboard shortcut for Hex Measure**. "M" is taken (Measure), "J" is taken (Journey). Could be Shift+M, or "H" if it doesn't collide with Help. Skipped here.
- **No undo for Hex Measure**. The third click resets, so you can't peel back just the second endpoint. Low priority.

## Plausible next-session moves

In rough scope order:

**Small (~20 min):**
- **Mobile fly-to gate for Hex Measure.** Pass `hexMeasureMode` into MapViewer and skip the `flyToBounds` block when true; or fitBounds to both endpoints when the second click lands.
- **Keyboard shortcut for Hex Measure.** Probably "H" (check for collision with `?` Help — `Shift+?` is help, "H" alone should be free).
- **"Roll one-off" defaults to current edge type when journey loaded.** Still open from last handoff.

**Medium (~45 min):**
- **Persist Hex Measure endpoints in URL.** `#hexA=G7&hexB=K12`. Symmetric to `#hex=G7` deep-linking. Useful for sharing a tactical situation.
- **Hex labels on the path.** Currently the cells fill cyan but the labels stay default-colored. Highlighting the label colour for endpoints would improve scannability when zoomed in.
- **Refactor the App ref type to use `MapViewerHandle`.** Small win against drift between the two declarations.

**Larger (~90+ min):**
- **Per-hex annotations** (still open from last handoff): optional `hexLabel?: string` on `MapAnnotation`. Pin-mode UI shows "Linked to G7" instead of "Linked to Khulut".
- **Variable-hexSize-aware route highlighting.** When `journeyRoute` is active, highlight the hexes the route crosses, plus a "hexes traversed: 14" stat. Recompute on hexSize change. Reuses `hexLineBetween` between consecutive route nodes.
- **Worldbuilder upstream**: push `biome` and `relationships:` through. Out of this repo's reach.

## Test layout (current)

```
web/src/utils/
├── annotations.test.ts           12
├── encounter-roller.test.ts       6
├── encounters.test.ts             4
├── faction-graph.test.ts         17
├── hex-grid.test.ts              32   (was 23 — +9 distance/line tests)
├── journey-days.test.ts           9
├── journey-graph.test.ts          6
├── layer-presets.test.ts          8   (was 7 — +1 Tactical preset test)
└── url-hash.test.ts               7   (new file)
                                 ───
                                 101
```

If you add measure-path persistence or hex-aware route highlighting, write tests next to `hex-grid.ts` (for any new pure helpers like a `hexesOnRoute(nodes)` function) and to a new `url-hash.test.ts` case (for new hash params). The pattern is property-based — see the line / distance tests for examples.

## Repo references

- `MASTER.md` — broad project + world + roadmap doc
- `README.md` — short tech-stack intro
- `AGENTS.md` — agent-onboarding (sync rules, do/don't)
- `HANDOFF-2026-05-09-zoom-and-hex-polish.md` — previous handoff
- `HANDOFF-2026-05-09b-hex-deep-link-and-distance.md` — this doc
