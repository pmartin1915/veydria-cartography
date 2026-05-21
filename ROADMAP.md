# Veydria Cartography — Roadmap

**Owner:** Perry Martin (GM, building this for an active TTRPG campaign)
**Last updated:** 2026-05-21
**Current state:** Phase 4+ shipped — interactive Leaflet map, hex grid + biome overlay, journey planner with seasons / modes / waypoints / multi-stop / fallback pivots / daily breakdown / encounters / calendar events / party config / save & share. 552/552 tests pass. Bundle 538.98 kB (gzip 166.69 kB).

This roadmap is **opinionated** — it reflects what I'd build next given the current architecture and what makes Veydria most useful to a GM. Reorder freely.

---

## North star

> The GM opens the map, picks a start and end, configures the party, and gets a fully prepped session: a day-by-day itinerary with weather, encounters, calendar events, supply pressure, and shareable player-facing artifacts. They can mark what the party has explored as the campaign moves forward.

Everything below is graded by **how much closer it gets us to that experience**, not by how much code it is.

---

## Tier 1 — Next feature: Rations + supply

**Why this first:** The party config we just shipped describes *who* is travelling. The natural next question a GM asks at the table is *can they make it there with what they're carrying?* The journey planner currently answers "how many days" and "what happens on the way" — adding supply pressure closes the loop on session-relevant logistics.

**User-visible behaviour:**

- New collapsible **Supply** block in the planner, sibling to the Party block.
- Inputs: rations per person, water per person, encumbrance (light/normal/heavy), pack animals (none / few / caravan).
- Outputs on every day in the day-by-day breakdown:
  - Rations remaining at end-of-day (`day.rationsLeft`)
  - Water remaining at end-of-day (`day.waterLeft`)
  - A warning line when either drops below the 2-day threshold ("Rations critical — 1 day remaining")
  - A failure line when either hits zero ("Out of water on day 4 — forced foraging or turnaround")
- New section in the markdown export: **Supply pressure** with the day rations/water hits each threshold.
- Forced march burns rations 2×, water 1.5× (modifiers, not hard rules — GM-overridable).
- Desert / arid biomes burn water 1.5× via `edgeBiomes`. Forest / wetlands neutral. Cold biomes burn rations 1.25×.

**Data model sketch** (in `web/src/utils/journey-supply.ts`, new file):

```ts
export interface SupplyConfig {
  rationsPerPerson: number   // days of rations carried
  waterPerPerson: number     // days of water carried
  encumbrance: 'light' | 'normal' | 'heavy'
  packAnimals: 'none' | 'few' | 'caravan'  // multiplier on carrying capacity
}

export const DEFAULT_SUPPLY: SupplyConfig = {
  rationsPerPerson: 7,
  waterPerPerson: 3,
  encumbrance: 'normal',
  packAnimals: 'none',
}

export interface SupplyDay {
  rationsLeft: number  // floating point; floor for display
  waterLeft: number
  rationsBurnedToday: number
  waterBurnedToday: number
  warning?: 'rations-low' | 'water-low' | 'rations-out' | 'water-out'
}

export function computeSupplyTimeline(
  days: JourneyDay[],
  party: PartyConfig,
  supply: SupplyConfig,
  edgeBiomes?: (string | undefined)[],
): SupplyDay[]
```

**Files affected:**

- `web/src/utils/journey-supply.ts` (new) — pure module, no DOM
- `web/src/utils/journey-supply.test.ts` (new) — minimum 4 tests: baseline, forced-march, arid biome, encumbrance
- `web/src/utils/journey-days.ts` — extend `JourneyDay` with optional `supply?: SupplyDay` (don't bake in; let the planner attach it after `buildDailyBreakdown` to keep `journey-days` free of supply concerns)
- `web/src/components/JourneyPlanner.tsx` — add `<SupplyConfig>` collapsible mirroring the party block; thread `supply` through to the daily render and the markdown export
- `web/src/utils/url-hash.ts` — add `supplyRations`, `supplyWater`, `supplyEnc`, `supplyPack` (omit defaults)
- `web/src/utils/journey-saved.ts` — add `supply?: SupplyConfig` to `SavedJourney`, include in dedupe-key
- `web/src/utils/campaign-log.ts` — Supply pressure section in journey export

**Size estimate:** ~1 working session. Mostly a mirror of the party-config pattern that just shipped.

**Dependencies:** None — sits on top of party config and biomes which are already in place.

**Validation:**
- Unit: 552 → ~565 tests
- Manual: walk Carna → Khazadar with `rationsPerPerson: 3, waterPerPerson: 2` and confirm the export shows the day water runs out

---

## Tier 2 — Differentiating features

These are the features that make the tool feel *essential* rather than nice-to-have. Pick one per cycle.

### 2a. Fog of war / explored hexes

**Why:** Campaign progress made visible. Right now the map is static; the world doesn't reflect what the party has discovered. Persistent "we've been here" state is the single highest-leverage feature for a session-to-session campaign aid.

**Behaviour:**
- New layer toggle: **Explored hexes** (off by default).
- When on, hexes the party has visited render at full colour; unexplored hexes render dimmed and biome-masked.
- New annotation type `kind: 'explored'` keyed by `hexLabel` — reuses the existing annotation persistence path.
- "Mark as explored" action on hex right-click (or hex info panel).
- "Mark route as explored" button in the journey planner — when you ship a session, one click stamps every hex the route touched.
- Share-mode URL respects fog: players see only explored hexes; GM sees everything.

**Files:**
- `web/src/utils/annotations.ts` — extend `MapAnnotation` with `kind: 'pin' | 'hex-note' | 'explored'`
- `web/src/utils/hex-overlay.ts` — new render path that dims unexplored cells (`PARCHMENT_UNEXPLORED_OPACITY`, biome desaturation)
- `web/src/components/MapViewer.tsx` — wire the layer toggle and right-click action
- `web/src/components/JourneyPlanner.tsx` — "Mark route explored" button after Save
- `web/src/utils/url-hash.ts` — add `fog=1` for share-mode

**Size:** ~1.5 sessions. Visual tuning will need a Chrome-agent audit pass like the parchment cycle.

### 2b. Player-view share URL (formalize `shareMode`)

**Why:** `shareMode` already exists as a prop and hides some panels in `JourneyPlanner.tsx`, but it's leaky — GM-only details (bottleneck strategic value, encounter beats, internal seasonal warnings) still surface in places. Making it rigorous turns "share a link" into a real product feature.

**Behaviour:**
- Audit every conditional render against `shareMode`.
- Strip GM-only content from the share URL: encounter beats, bottleneck strategic reasoning, unencountered calendar crisis flags, GM annotation bodies.
- Two-link export from the planner: "GM link" (full) and "Player link" (filtered).
- Player link suppresses Annotations panel, Encounters tab, Roll one-off, the comparison-route trophies (just shows the chosen route), and any feature whose `properties.gm_only` is true.

**Files:**
- `web/src/components/JourneyPlanner.tsx` — audit `shareMode` gates; centralize the rule in a `usePlayerView()` helper
- `web/src/utils/annotations.ts` — `gmOnly?: boolean` on `MapAnnotation`
- `web/src/utils/url-hash.ts` — `share=1` already exists; tighten the contract
- `web/src/App.tsx` — separate render branch for share mode that hides the GM-only sidebar items
- Tests — a `share-mode-isolation.test.ts` that snapshots the planner's output in share vs GM mode for the same route

**Size:** ~1 session. Mostly auditing and adding tests.

### 2c. Multi-party tracking

**Why:** "We split the party" is a GM headache. Letting the tool track multiple parties on different routes (or stationary) makes session prep for split-group play tractable.

**Behaviour:**
- Saved journeys grow a `partyName?: string` field (defaults: "Main party"). Free text — players name their group.
- New top-level dropdown in the planner: "Active party". Switching parties swaps the route + party config + supply config.
- The campaign log roll-up groups by party name.
- Share URLs encode `party=name` so different players see different views (the players who split off get a link with only their party's info).

**Files:**
- `web/src/utils/journey-saved.ts` — `partyName?: string` on `SavedJourney`
- `web/src/components/JourneyPlanner.tsx` — party-name dropdown
- `web/src/utils/campaign-log.ts` — group savedJourneys by partyName
- `web/src/utils/url-hash.ts` — `party=name`

**Size:** ~0.5 session. Genuinely small, but only matters if Perry's campaign is doing split-party play. Defer unless the use case actually materializes.

---

## Tier 3 — Architectural debt

Pay this down *before* a big feature add, not as a standalone exercise. Invisible to the user but pays dividends every future cycle.

### 3a. Split `JourneyPlanner.tsx` (1526 lines)

The component now owns: season, mode, party, waypoints, comparison, departure date, saved journeys, annotations panel, 3 tabs, 4 export formats, 2 collapsible sub-panels. It's the spine of the app and also its biggest file.

**Proposed split:**

```
JourneyPlanner.tsx             (container — state, effects, layout)
├── JourneyControls.tsx        (Season, Mode, Party, Supply blocks)
├── JourneyEndpoints.tsx       (From, Swap, To, waypoints, Add waypoint)
├── JourneyResults.tsx         (stats, difficulty, comparison cards)
├── JourneyRouteTab.tsx        (path timeline, bottlenecks, seasonal warnings)
├── JourneyDaysTab.tsx         (day-by-day cards)
├── JourneyEncountersTab.tsx   (segment chips, one-off roll, encounter cards)
├── SavedJourneysPanel.tsx     (list, rename, load, delete)
└── useJourneyState.ts         (custom hook centralizing planner state)
```

**Constraints:**
- Don't pre-design abstractions for hypothetical reuse — keep the helpers internal to the planner directory.
- Component boundaries map to **what changes together**, not what looks visually distinct.
- Keep the existing tests passing without modification — the export surface (`<JourneyPlanner>`) doesn't change.

**Size:** ~1 session if done as pure refactor. ~2 if paired with bug-finding (you will find at least one stale closure or missed effect dep).

### 3b. `journey-graph.ts` edge mutation

`findRoute` (line 470-475) mutates `edge.segmentDays` on the shared adj-list edge instances. Today it's safe because all callers in a single render pass use the same party. Tomorrow it's a footgun for any feature that holds an edge reference across renders (e.g. "remember the last computed route for diff").

**Fix:** Return a fresh `pathEdges` array of new edge objects rather than mutating in place. ~30 lines, no API change.

**Size:** ~0.25 session. Do as a drive-by during the next journey-graph touch.

### 3c. `App.tsx` (1867 lines) and `App.css` (6935 lines)

App.tsx is harder to split because it's the wiring root — leave it alone unless a specific feature forces a touch.

App.css at ~7000 lines is the more interesting target. Convert to CSS modules per-component, or migrate the worst sections to colocated `<Component>.module.css` files as components get split out in 3a. This is a slow burn, not a sprint.

**Size:** ongoing, opportunistic.

### 3d. Bundle size

166 kB gzip is fine but the trend is up (+14 kB from party config alone). Two cheap wins:

1. **Lazy-load the JourneyPlanner.** It's the largest non-route module. `React.lazy(() => import('./components/JourneyPlanner'))` saves ~50 kB on first paint for users who never open the planner.
2. **Code-split the encounter tables and calendar data.** They're large static JSON blobs in `generated/`. Already in their own file, just need a dynamic import behind the encounters tab.

**Size:** ~0.5 session for both.

---

## Tier 4 — Polish & cosmetics

Roll these into the next session that touches the relevant file. Don't do them as a standalone PR.

- **Markdown export trims default party fields** — currently emits `Party: foot · fast pace · medium party` when only pace differs. Should mirror `isDefaultParty` logic: only include the fields that differ from default. Affects `JourneyPlanner.tsx:374-381` and `campaign-log.ts:29-36`.
- **Comparison cards don't show party in tooltip.** When `compareMode` is on, the three card tooltips should say "Direct route with mounted party (fast pace)" not just "Click to switch to Direct route". One-line change in `JourneyPlanner.tsx:1132`.
- **Day-by-day "exhaustion" line is a one-time roll-up, not per-day stacking.** Currently emits the same forced-march line every day, which is correct flavor but a real D&D rule stacks exhaustion levels. Could either show the running level ("Day 3: Exhaustion 2") or leave as-is (flavor text is fine). Tag the bikeshed and move on.
- **Time-of-day filter integration with encounters.** `time-of-day.test.ts` exists; the filter affects map rendering but not encounter generation. A night-time encounter table differs from a daytime one. Wire `timeOfDay` into `generateEncounters` and the table seeding.

---

## Cross-cutting — testing & infra

### Visual / e2e tests (priority: medium-high)

552 unit tests is great, but UI ships blind. The parchment cycle relied on Claude Chrome-agent for visual audit — that worked but is per-cycle, not a regression net.

**Proposal:** A small Playwright suite — not exhaustive, just smoke. ~5 tests:

1. Map loads, hex grid visible, no console errors.
2. Open the journey planner, pick two civs, route renders, day tab shows >0 days.
3. Toggle Party → Mount = mounted, confirm estimated days decreases.
4. Save the journey, reload, confirm it's restored from localStorage with the saved party config.
5. Copy share link, navigate to it, confirm the route auto-computes with the right party.

Each test runs in <5s. Total suite ~25s. Cheap to maintain.

**Files:**
- `web/playwright.config.ts` (new)
- `web/tests/smoke.spec.ts` (new)
- `.github/workflows/ci.yml` — add a `playwright` job after `test`

**Size:** ~0.5 session.

### CI improvements

- **Add bundle-size budget** to CI — fail if `web/dist/assets/index-*.js` exceeds 200 kB gzipped. Catches regressions like the +14 kB this cycle from drifting up unchecked.
- **Run `tsc --noEmit` in CI.** Not currently in `.github/workflows/ci.yml` if the prior handoff is accurate — should be.

---

## What's NOT on the roadmap

Things I considered and rejected, for the record:

- **A real-time multiplayer GM/player view.** Too much infra cost (WebSocket server, auth, state sync) for what is fundamentally a session-prep tool. Shareable URLs cover the player-visibility use case.
- **NPC roster as a first-class entity.** Annotations + feature notes already cover this. Don't add a new data model.
- **Combat encounter resolution / dice roller.** Belongs in a VTT (Foundry, Roll20). Veydria stays a session-prep map, not a play surface.
- **Switching to MapLibre or another tile-based renderer.** Leaflet + SVG schematic is fine. The pain points are UI, not rendering.
- **Internationalization.** Single user, English-only. Adds friction for no value.
- **Heavy AI generation features.** PixelLab is lapsed; Replicate is cost-sensitive (per CLAUDE.md). Pure-data features only; visual asset generation stays manual.

---

## Sequencing recommendation

If I had four sessions, I would spend them like this:

1. **Tier 1 — Rations + supply.** Highest GM payoff. Mirrors a known-good pattern.
2. **Tier 3a partial — Split `JourneyPlanner.tsx` into 3-4 files.** Before the planner gets any heavier. Don't try for the full 8-file split; just the lowest-hanging two or three.
3. **Tier 2a — Fog of war.** Now that the planner is split, this is much cheaper. Wires straight into the existing annotation persistence layer.
4. **Cross-cutting — Playwright smoke + bundle budget.** Lock in the regression net before the next big feature.

After that, Tier 2b (player-view rigor) and Tier 2c (multi-party) become situational — wait for the campaign itself to demand them.

---

## Memory pointers

Per the auto-memory system at `~/.claude/projects/C--Users-perry-DevProjects-veydria-cartography/memory/`:

- `project-state.md` — refresh after each major ship
- `project-bugs.md` — append resolved bugs that taught a non-obvious lesson (the Dijkstra `??` fix is the canonical example)

After any feature in this roadmap ships, the next instance should update `project-state.md` with the current test count, bundle size, and a one-line note on what shipped.
