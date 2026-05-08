# Handoff — 2026-05-08 audit-test closeout + master doc

*Continues from `HANDOFF-2026-05-07-qol-and-tests.md`. That one closed five QoL features plus two audit fixes. This one closes the last deferred audit item, fixes a UTF-8 mojibake bug visible on the map, and lands the master doc + roadmap.*

## State at close

- Branch `master`, all commits pushed to `origin/master`, working tree clean (only untracked is `.claude/` local settings).
- Tests: **38/38 pass** (was 31/31; +7 new in `layer-presets.test.ts`).
- CI: green on `470de83` and `4eb1f9d` — last 5 runs all green, ~22s each.
- Build: `tsc -b && vite build` — ~530 kB / 162 kB gzip; chunk-size warning is informational.
- Dev server: `cd web && npm run dev`.

## Commits added this session

| SHA | Title |
|---|---|
| `4eb1f9d` | fix(audit): clamp snapshot megapixels + defensive preset-apply merge *(prior session, recapped)* |
| `470de83` | test(presets): pin defensive merge + corrupt-localStorage handling |
| *(this)* | docs+fix: master doc, roadmap, handoff, fix mojibake in public SVG |

## What landed

### 1. Closed the last deferred audit item — preset robustness

Item 7 of the in-app walkthrough audit had been skipped when the laptop died mid-session. Closed via unit tests rather than browser localStorage injection — strictly stronger because the behaviour is now pinned in CI and won't regress silently.

`web/src/utils/layer-presets.test.ts` (new — 153 lines, 7 tests):

- 3 tests cover the defensive `{ ...prev, ...preset.layers }` merge from `App.tsx:772-773`:
  - Stale preset (saved before `faction_control` / `terrain_cost` were added) merges cleanly without producing `undefined` values.
  - Empty preset is a no-op against current state.
  - Every built-in preset carries every schema key — guards against a built-in silently going stale when the schema grows. (All six pass today.)
- 4 tests cover `loadCustomPresets` against corrupt storage:
  - Empty storage → `[]`.
  - Invalid JSON → `[]`.
  - Non-array (object) → `[]`.
  - Mixed-malformed array → only well-formed entries returned.

Per-file `// @vitest-environment happy-dom` for the localStorage block; the rest of the suite stays on `node`. `happy-dom` was already a devDep, no install needed.

### 2. Fixed the mojibake on the map title

Visible bug discovered while reviewing the live screenshot: the map subtitle rendered as `Continental Schematic â€" Spatial Reference` instead of `Continental Schematic — Spatial Reference`.

Root cause: `web/public/veydria-schematic.svg` had been written somewhere in its history with the bytes from `data/veydria-schematic.svg` re-interpreted as Latin-1 and re-encoded to UTF-8 — double-encoding the em-dash. The data/ source was clean.

Fix: re-copied `data/veydria-schematic.svg` over `web/public/veydria-schematic.svg` (overwriting the corrupted version, also dropping the BOM and CRLF endings the corrupted copy had). Confirmed both lines now render correctly:

```
<title>Veydria Continental Schematic — Spatial Reference Map</title>
... text ... >Continental Schematic — Spatial Reference</text>
```

Note for next instance: `scripts/sync-world-data.mjs` syncs *worldbuilder → data/* but does NOT also sync *data/ → web/public/*. The public copy is a manual mirror. If mojibake reappears, either re-copy by hand or extend the sync script.

### 3. Added `MASTER.md` — the project's first single-source-of-truth doc

The HANDOFF series captures sessions but no single document told a new contributor what the project is, what the world is, or where it's going. `MASTER.md` is now that document. Sections:

1. **What this is** — two-output system (static + interactive) sharing one YAML.
2. **The world** — one-page summary of Veydria, the Aethelian Basin, civs, what the layers represent.
3. **Architecture** — full data-flow diagram + per-interaction flow.
4. **Current feature inventory** — table of what's shipped.
5. **Roadmap** — three horizons (near / mid / exploratory), each item sized.
6. **Guided tour design sketch** — full step-by-step plan with risk notes; ~4–6 hours of work when prioritised.
7. **Conventions** — localStorage versioning, test placement, the data/ → public/ gotcha.
8. **Repo references** — pointer table.

This doc replaces *no* existing file; `README.md` and `AGENTS.md` keep their narrower scope. `MASTER.md` is the doc to load into context for a new session that needs broad orientation.

## UX observations from the live screenshot

These came out of reviewing the running app in the browser; they're recorded here as the input for a future polish session. None are urgent.

- **Right info panel is fixed-width 30%.** Useful at the top end (good readability) but cramps the map on a 13" laptop. A collapsible drawer would help.
- **Player banner at the very top** is functional but easy to crop out of a screenshot. Slight contrast bump or a subtle border would help it survive an accidental crop in a Discord paste.
- **Feature count chip ("3052 features")** is static text. Make it a button that opens the search palette — high-affordance, near-zero cost.
- **Layer panel sliders** show their value (`85%`, `50%`, etc.) but have no quick "set to 100%" / "double-click to reset" gesture. Minor.
- **Annotation popup has 3 button rows** (label/body, colour, link, actions). Single-row toolbar would be cleaner — already noted in the prior handoff.
- **Snapshot from a non-share URL captures annotations.** A "Snapshot for players" variant that toggles share-state for the duration of capture would solve this without GMs having to manually load `#share=1` first.

The full prioritised list lives in `MASTER.md` §5.

## Suggested next thread

Pick one of these — they're roughly equal-sized:

- **Polish run** (small): the six items in `MASTER.md` §5 "Near term" — should be one session if batched.
- **Random encounter roller** (small–medium): live mid-route encounter rolls. High GM-utility-per-LOC.
- **Guided tour** (medium): full design in `MASTER.md` §6. ~4–6 hours; the right move once a couple of polish items are in (so the tour doesn't immediately rot).
- **Mobile player view** (medium): make the `#share=1` URL render cleanly on a phone — no editing, just panning, info panels, and the journey path. Probably the highest-value direction for at-the-table use.

The tour is the most *integrative* — it forces the team to acknowledge the surface area we now have. But polish should probably go first so the tour points at a polished UI, not a half-polished one.

## Test layout (current)

```
web/src/utils/
├── annotations.test.ts        (12 tests — schema, migration, findNearestFeature)
├── encounters.test.ts         ( 4 tests — determinism, season variation)
├── journey-days.test.ts       ( 9 tests — bucketing math, determinism)
├── journey-graph.test.ts      ( 6 tests — Dijkstra fix, civ-pivot fallback)
└── layer-presets.test.ts      ( 7 tests — defensive merge, corrupt storage)  ← new
                               ────
                                38 tests total
```

Run with `npm test`. Add new tests next to the module they cover.
