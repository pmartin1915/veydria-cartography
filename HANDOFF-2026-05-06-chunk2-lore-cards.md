# Handoff — Chunk 2: Lore-Rich Segment Cards + Route Difficulty

*Date: 2026-05-06*
*Scope: Phase 6.1 (lore-rich tooltips) + §7 route difficulty class*
*Build: ✅ `npm run build` passes, `tsc --noEmit` clean*

---

## What changed

### 1. `web/src/utils/journey-graph.ts`
- **Added `commodities?: string` and `consequenceIfClosed?: string`** to `JourneyEdge` interface.
- **Piped both fields through `buildGraph()`** on trade_route edges (lines 237–246). They flow from GeoJSON properties `commodities` and `consequence_if_closed`, which were already exported by `generator/export/geojson.py`.
- **Added `getRouteDifficulty(route)`** — derives a difficulty badge from edge composition:
  - `chokeRatio >= 0.5` → "Explorer-grade" (orange)
  - `tradeRatio >= 0.7` → "Merchant-grade" (green)
  - `chokeRatio >= 0.25` → "Mixed-trail" (purple)
  - default → "Merchant-grade"

### 2. `web/src/components/MapViewer.tsx`
- **Expanded journey segment tooltips** (lines 786–800) to show:
  - `commodities` — styled as `.journey-seg-lore` (tan, 📦 prefix)
  - `consequenceIfClosed` — styled as `.journey-seg-consequence` (salmon, italic, ⚡ prefix)
  - Existing bottleneck + seasonal warning preserved.
- **Enriched marker hover tooltips** (lines 502–508) to show:
  - `etymology` — italic, secondary text
  - `function` — blue-tinted, for ports and other points that carry it

### 3. `web/src/components/JourneyPlanner.tsx`
- **Imports `getRouteDifficulty`** from `journey-graph.ts`.
- **Displays difficulty badge** below route stats (lines 724–730) — a small pill with color-coded class.
- **Added difficulty to markdown export** — `"**Difficulty:** ${diff.label}"` appears in the copied markdown handout.

### 4. `web/src/App.css`
- `.journey-seg-lore` / `.journey-seg-consequence` — tooltip lore fields
- `.popup-etymology` / `.popup-function` — marker hover enrichment
- `.journey-difficulty` / `.journey-difficulty-badge` + `.merchant` / `.explorer` / `.mixed` / `.trivial` — difficulty pill styles

---

## What's still pending for Phase 6

- **Chunk 3:** Deterministic encounter generator (`encounters.ts`, Encounters tab, markdown integration)
- **Chunk 4:** Map annotations (pin tool, edit panel, localStorage, campaign notes export)
- **Polish:** Measure scale legend, lazy-load journey planner, Vitest harness

---

## Known issues / notes

- Tooltips are `max-width: 260px` with line-wrapping. If a `consequence_if_closed` string is extremely long, it will wrap gracefully.
- The marker tooltip enrichment applies to *all* point features that carry `etymology` or `function` in GeoJSON properties. This is automatic — no category filtering needed.
- Route difficulty is computed from edge *counts*, not weighted by distance. This is intentional: a single chokepoint in a 10-segment route still changes the character of the journey.

---

## Resume point

Pick up at **Chunk 3: Deterministic encounter generator** from `research/2026-05-06-phase-6-research.md` §2.2.
