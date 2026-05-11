# Handoff: Calendar Nice-to-Haves — Month Approximation & Sync Infrastructure

## Branch
`auto/season-nothing-beats-2026-05-10`

## What shipped

### 1. Month/day approximation display

`formatDayOfYear` now includes an approximate real-world month for easier GM mental mapping.

- **Format:** `Day N (season ~period Month)` — e.g. `Day 120 (spring ~late April)`
- **Helper:** `dayToApproximateDate(day)` splits the 365-day year into actual month boundaries (Jan 1–31, Feb 32–59, etc.) and returns `{ month, period }` where period is `early` / `mid` / `late` based on position within the month.
- **Edge cases:** clamps out-of-range days; handles February's 28-day window correctly.

**Files:** `web/src/utils/calendar.ts`, `web/src/utils/calendar.test.ts`

### 2. Calendar sync from worldbuilder

Set up the infrastructure so that when worldbuilder gets a dedicated `calendar-events.yaml`, the cartography repo can sync and regenerate automatically.

- **Canonical source:** `data/calendar-events.yaml` — structured YAML with all 56 calendar events
- **Generator:** `generator/export/calendar_ts.py` reads the YAML and outputs `web/src/generated/calendar-events.ts`
- **Import:** `web/src/utils/calendar.ts` imports `VEYDRIA_CALENDAR_EVENTS` from the generated file and re-exports it as `VEYDRIA_CALENDAR` (same public API — no breaking changes)
- **Sync script:** `scripts/sync-world-data.mjs` updated with an optional entry for `timeline/calendar/calendar-events.yaml`. If the file doesn't exist in worldbuilder yet, it skips gracefully with a log message.
- **NPM script:** `npm run generate:calendar` (in `web/`) invokes the Python generator

**Workflow:**
```bash
# When worldbuilder adds calendar-events.yaml:
node scripts/sync-world-data.mjs          # copies YAML into data/
cd web && npm run generate:calendar       # regenerates TS
```

**Files:**
- `data/calendar-events.yaml` (new)
- `generator/export/calendar_ts.py` (new)
- `web/src/generated/calendar-events.ts` (new, auto-generated)
- `web/src/utils/calendar.ts` (imports generated array, adds month helpers)
- `scripts/sync-world-data.mjs` (optional sync entry)
- `web/package.json` (`generate:calendar` script)

### 3. MASTER.md updates

- Test count updated: 364/364
- Architecture diagram now includes `data/calendar-events.yaml` and `web/src/generated/calendar-events.ts`
- Calendar layer description updated with month approximation and generator workflow

## Stats

- `tsc --noEmit`: clean
- `vite build`: green
- `vitest run`: **364/364 passing** (22 files) — up from 358 (+6 new tests)
- `python pipeline.py validate`: green
- Git: working tree clean, ready to commit

## Dev server

Already running on port 5173. If it dies, restart with:
```bash
cd web && npm run dev
```

## Remaining open items

Both original nice-to-haves are now resolved. No remaining calendar follow-ups.
