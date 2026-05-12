# Handoff: Adventure Hooks per Feature

## Branch
Merged to `master` from `auto/season-nothing-beats-2026-05-10`

## Commit
`f3c779c` — feat: adventure hooks per feature — seeded deterministic generator + InfoPanel UI + tests

## What shipped

Every clickable location on the map now has a deterministic adventure-hook generator in its InfoPanel.

### Category-specific pools

9 pools (port, chokepoint, oasis, contested site, civilization, trade route, water, landmark, river) with ~10 Veydria-specific templates each. Templates reference actual factions, geography, and lore (Harbor Oath War, Metal Interdict, Tavakh Qarat, etc.).

### Deterministic

Same feature ID always produces the same 3 hooks (`djb2Hash` + `mulberry32`, same RNG as encounters).

### Rerollable

Click "🎲 Roll" or "🎲 Reroll" for a fresh seeded set.

### Tagged

Each hook gets auto-derived tags (trade, conflict, political, supernatural, treasure, religious, disease) plus its category tag.

### Persistent

Generated hooks cached in `localStorage:veydria.hooks.v1` per feature.

### UI

Sits between "Lore & Sources" and "GM Notes" in the InfoPanel, with styled cards and tag chips.

## Files touched

| File | Change |
|---|---|
| `web/src/utils/feature-hooks.ts` | **new** — generator + persistence |
| `web/src/utils/feature-hooks.test.ts` | **new** — 18 tests |
| `web/src/utils/encounters.ts` | exported `djb2Hash` + `mulberry32` |
| `web/src/components/InfoPanel.tsx` | hooks section + roll button |
| `web/src/App.css` | hooks card/tag styles |
| `MASTER.md` | updated |

## Validation

| Check | Result |
|---|---|
| TypeScript compilation | Clean (`tsc --noEmit`) |
| Vitest tests | **391/391 passing** (23 files) |
| Vite production build | Green, ~422 KB JS (~130 KB gzipped) |
| Python pipeline validate | Green |

## Remaining open items

None. The adventure hooks feature is fully implemented and merged to master.
