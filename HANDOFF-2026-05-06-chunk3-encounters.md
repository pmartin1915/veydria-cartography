# Handoff — Chunk 3: Deterministic Encounter Generator

*Date: 2026-05-06*
*Scope: Phase 6.2 (encounter generator)*
*Build: ✅ `npm run build` passes, `tsc --noEmit` clean*
*Bundle delta: +8.86 KB JS gzipped, +2.29 KB CSS gzipped*

---

## What changed

### 1. `web/src/utils/encounters.ts` (new)
- **Seeded RNG:** `djb2Hash` + `mulberry32`. Same route signature → same encounters, every time.
- **Signature:** `nodeIds.join('|') + '#' + season + '#' + mode`
- **30 hand-authored beats** across three pools:
  - **Trade Route (12 beats)** — merchants, tolls, broken carts, seasonal floods/heat/mud/ice
  - **Chokepoint (10 beats)** — pass guards, rockfalls, maritime patrols, bandit-sign, corpses
  - **Intra-civ (10 beats)** — oasis hospitality, Qalībin negotiations, Basin fever, slate-quarry guards
  - **Nothing (3 beats)** — uneventful travel for the 15-40% of segments that roll quiet
- **Season filtering:** Beats tagged with `seasons` or `excludeSeasons` are filtered before selection. Season-specific beats are weighted heavily so they surface when relevant.
- **Long-leg bonus:** Segments > 5 days get a second encounter roll (independent RNG seeded at `seed + segmentIdx + 10007`).
- **Encounter model:** `{ segmentIdx, beat, type, severity, narrative }` where `type` ∈ {social, environmental, combat, opportunity} and `severity` ∈ {mild, moderate, severe}.
- **Helper exports:** `encounterTypeIcon()` and `encounterSeverityLabel()` for display.

### 2. `web/src/components/JourneyPlanner.tsx`
- **Imports** `generateEncounters`, `encounterTypeIcon`, `encounterSeverityLabel`.
- **Added `routeTab` state** (`'route' | 'encounters'`) — defaults to `'route'`.
- **Tab bar** below difficulty badge switches between Route view and Encounters view.
- **Route tab** contains the existing path timeline + bottlenecks + seasonal warnings.
- **Encounters tab** shows:
  - Beat count header + "Seeded by route signature" subtitle
  - One card per encounter with: type icon, type label, severity pill, segment name, beat text
  - Color-coded left border: green (mild), orange (moderate), red (severe)
- **Markdown export** now includes an `### Encounters` section with type, severity, segment name, and beat text for each rolled encounter.

### 3. `web/src/App.css`
- `.journey-tabs` / `.journey-tab` / `.journey-tab.active` — tab switcher styling
- `.journey-encounters` / `.journey-encounter` / `.journey-encounter-beat` — encounter cards
- Severity variants: `.mild` (green), `.moderate` (orange), `.severe` (red) for both border and pill

---

## What's still pending for Phase 6

- **Chunk 4:** Map annotations (pin tool, edit panel, sidebar list, localStorage, campaign notes export)
- **Polish:** Measure scale legend, lazy-load journey planner, Vitest harness

---

## Known issues / notes

- The encounter beats are **lore-heavy** as requested. They name-check Qalībin path-finders, Khazadari khatti letters of credit, Oravan wave-tithes, Irrah salt caravans, Tavakh Qarat healers, Ndajdi foresters, Ngaru-Bon slate-porters, etc.
- Determinism is guaranteed by the seed hash. Copying the journey link and re-computing the same route will produce identical encounters.
- The "Nothing" beats are unremarkable travel. The GM can either skip them or use them as breathing room.
- Season-specific beats exist for all four seasons across the three pools. When a season is selected, those beats are mixed in at higher weight.

---

## Resume point

Pick up at **Chunk 4: Map annotations** from `research/2026-05-06-phase-6-research.md` §2.3.
