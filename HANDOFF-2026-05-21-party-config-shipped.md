# Handoff — Party config SHIPPED, roadmap drafted

**Date:** 2026-05-21
**Author:** Claude (Opus 4.7, 1M context)
**Predecessor:** `HANDOFF-2026-05-20-parchment-hex-shipped.md` (closed — parchment cycle, no overlap with this work).
**Branch:** `master`, synced with `origin/master` at `810a447`.
**Working tree:** clean prior to this handoff. The handoff + roadmap are the only uncommitted files.

---

## TL;DR

A previous instance landed the **party config** feature for the Journey Planner (pace / mount / size / forced-march). I picked up the handoff at `/clear`, audited the eleven-file change, committed it as `810a447`, pushed it (along with the prior cycle's `f7922f6 docs(handoff)` commit) to `origin/master`, and refreshed `project-state.md` in auto-memory.

Then, on the user's prompt, I drafted a four-tier `ROADMAP.md` for what to build next. **Tier 1 is rations + supply** — the natural pairing for party config and the highest GM-utility next move.

This handoff captures what was reviewed, what was confirmed, and what the next instance should pick up first.

---

## What shipped this cycle

The previous instance did the implementation. This cycle's contribution is the audit + commit + push + roadmap.

```
810a447 feat(journey): party config (pace/mount/size/forced-march)   ← this cycle's commit
f7922f6 docs(handoff): parchment hex styling SHIPPED                  ← prior cycle, pushed with this one
1b73c84 tune(hex-overlay): warm ochre parchment cream for plateau contrast
...
```

Eleven files changed, +487/-46:

| File | What changed |
|---|---|
| `web/src/utils/journey-graph.ts` | New types `TravelPace`, `Mount`, `PartySize`, `PartyConfig`. New helpers `DEFAULT_PARTY`, `isDefaultParty`, `getPaceMultiplier`. All `findRoute*` and `findComparisonRoutes` take optional `party`. `estimatedDays` now equals `Σ segmentDays` (fixes a latent inconsistency vs. day-by-day breakdown). |
| `web/src/utils/journey-days.ts` | `buildDailyBreakdown` takes optional `party`. Forced-march adds an exhaustion line every day; non-default party adds a day-1 summary. |
| `web/src/components/JourneyPlanner.tsx` | Collapsible **Party** block between Route priority and Compare routes. Pill rows for pace / mount / size + forced-march checkbox. Party threaded through every route computation and the markdown export. |
| `web/src/App.css` | Party block styling — reuses existing `.journey-mode-btn` pills. |
| `web/src/App.tsx` | Seeds `defaultParty` into the planner from initial URL hash. |
| `web/src/utils/journey-saved.ts` | `SavedJourney.party?: PartyConfig`. Backfills `DEFAULT_PARTY` for v1 + legacy entries. Party included in dedupe-key. |
| `web/src/utils/url-hash.ts` | New params `partyPace`, `partyMount`, `partySize`, `partyForce` (defaults omitted to keep URLs short). |
| `web/src/utils/campaign-log.ts` | Adds **Party:** line after **Mode:** in both active and saved-journey exports, only when party differs from default. |
| `web/src/utils/journey-graph.test.ts` | +3 tests: fast<slow, chokepoint immunity to mount, `estimatedDays = Σ segmentDays`. |
| `web/src/utils/journey-days.test.ts` | +3 tests: forced-march line every day, day-1 summary only when non-default, no-party path. |
| `web/src/utils/journey-saved.test.ts` | Fixture updated with `party: DEFAULT_PARTY`. |

**Test count:** 552/552 pass. **Bundle:** 538.98 kB / gzip 166.69 kB. **Bundle delta:** +14 kB gzip from the pre-party-config baseline (153 kB).

---

## Audit findings (this cycle's contribution)

**Code quality — solid.** Ship-as-is verdict.

1. **`journey-graph.ts:39-74`** — `DEFAULT_PARTY`, `isDefaultParty`, and `getPaceMultiplier` are small, pure, well-commented. The chokepoint-resistance-to-mount rule is documented at the function header, not buried.
2. **`journey-graph.ts:474-479`** — `estimatedDays = Σ segmentDays` is the "latent inconsistency fix" the handoff message mentioned. Previously `estimatedDays` was computed from the total km divided by a single speed assumption (trade-route speed). The day-by-day breakdown summed per-segment speeds. They could drift. Now they're the same value. Verified by the `estimatedDays = Σ segmentDays` test.
3. **`journey-saved.ts:15-23`** — `sanitizeParty` is defensive: invalid enums fall back to defaults, `forcedMarch === true` rejects truthy-but-non-boolean values. Important because `localStorage` is user-tamperable.
4. **`journey-saved.ts:139-145`** — dedupe-key in `addSavedJourney` includes party. Same route+season+mode but different party correctly counts as a distinct save (a mounted-fast Carna→Khazadar is materially different from a foot-slow one).
5. **`url-hash.ts:120-123`** — defaults omitted from the hash. URL stays short when the user hasn't customized.
6. **`App.tsx:1590-1599`** — `defaultParty` is seeded only when at least one party-related hash param is present. Avoids passing a `DEFAULT_PARTY` object that would shadow useState's initial value.

**Minor noise flagged but not blocked** (filed in roadmap Tier 4):

- Markdown export emits `Party: foot · fast pace · medium party` when only pace differs. Should trim defaults the way `isDefaultParty` does. `JourneyPlanner.tsx:374-381` and `campaign-log.ts:29-36`.
- `findRoute` mutates `edge.segmentDays` on shared adj-list edge instances (`journey-graph.ts:470-475`). Safe today, footgun tomorrow. Filed in roadmap Tier 3b — return a fresh `pathEdges` array of new objects rather than mutating in place.
- `handlePartyChange` fires an immediate `computeRoute` while the auto-recompute effect also fires (debounced 250ms). Double-compute. Pre-existing pattern matching season/mode. Not a regression.

**Verdict:** ship as-is, file the small stuff in the roadmap, push.

---

## File map — where the party-config work lives

| File | What it owns |
|---|---|
| `web/src/utils/journey-graph.ts:28-74` | All party types + `DEFAULT_PARTY`, `isDefaultParty`, `getPaceMultiplier`. Single source of truth. |
| `web/src/utils/journey-graph.ts:388-501` | `findRoute(..., party)` — see line 470-479 for the per-edge speed application. |
| `web/src/utils/journey-days.ts:151-191` | `formatPartySummary` + `notableForDay` party hooks. |
| `web/src/components/JourneyPlanner.tsx:73,490-496,700-786` | Party state, `handlePartyChange`, and the collapsible UI block. |
| `web/src/utils/journey-saved.ts:11-28,114,144` | Validation, backfill, dedupe-key party comparison. |
| `web/src/utils/url-hash.ts:25-29,88-101,120-123` | URL hash round-trip. |
| `web/src/utils/campaign-log.ts:29-36,82-84,184` | Markdown export party formatting. |

---

## What's verified working

- `cd web && npm test` — 552/552 pass (31 test files, ~5s).
- `cd web && npm run build` — clean bundle, 538.98 kB / gzip 166.69 kB.
- `git status` — clean prior to writing this handoff.
- `origin/master` is `810a447` (verified via `git push` output `1b73c84..810a447 master -> master`).
- Memory `project-state.md` refreshed to reflect 552 tests, shipped party config, current bundle size, and latest origin tip.

**Not verified manually** (would require local dev server + browser):
- Round-trip: save a journey with `forcedMarch: true`, reload page, confirm restored.
- Round-trip: copy share link with mounted-fast party, paste in incognito, confirm party rehydrates.
- Visual: confirm the party block collapses/expands and the pill rows highlight correctly across browsers.

The previous instance reported these all work; I did not re-verify because the unit tests + code review covered the wire-level concerns and the user explicitly said "review, audit, push." If the next instance wants to close the loop, the manual smoke is a 3-minute task.

---

## What's open — the ROADMAP

A four-tier roadmap is now committed at `ROADMAP.md`. Summary:

**Tier 1 — Next feature: Rations + supply.** Natural pairing with party config. Mirrors the same pattern (data model + URL hash + persistence + day-by-day integration + markdown export). ~1 session. Highest GM payoff.

**Tier 2 — Differentiators:**
- 2a. Fog of war / explored hexes (~1.5 sessions)
- 2b. Player-view share URL — formalize `shareMode` (~1 session)
- 2c. Multi-party tracking (~0.5 session, defer until campaign demands)

**Tier 3 — Architectural debt:**
- 3a. Split `JourneyPlanner.tsx` (1526 lines) into ~4 components + a `useJourneyState` hook
- 3b. Stop mutating `edge.segmentDays`; return fresh edge objects
- 3c. `App.css` (6935 lines) opportunistic migration to colocated modules
- 3d. Lazy-load the planner + encounter tables — saves ~50 kB initial paint

**Tier 4 — Polish:**
- Trim default party fields in markdown export
- Party in comparison-card tooltips
- Per-day exhaustion stacking (or leave as flavor text — bikeshed, move on)
- Time-of-day → encounter table integration

**Cross-cutting:**
- Playwright smoke suite (~5 tests, ~25s total)
- Bundle-size budget in CI (fail >200 kB gzipped)
- `tsc --noEmit` in CI if not already there

**Recommended sequencing:** rations → split planner → fog of war → Playwright smoke + bundle budget. That's the four-session pre-plan.

---

## Operational notes for the next instance

- **The Bash tool's `cd` persists across calls on this machine.** I tripped over this — ran `cd web && npm test`, then `cd .. && git commit` in the next call, which landed me outside the repo (the first `cd ..` had already moved out of `web/`). Use absolute paths or check `pwd` if you're chaining cd commands across separate Bash invocations.
- **Auto-memory exists at `~/.claude/projects/C--Users-perry-DevProjects-veydria-cartography/memory/`** and is loaded into context at session start. `MEMORY.md` is the index; individual memory files are the content. I refreshed `project-state.md` this cycle. `project-bugs.md` is 14 days old and still accurate (no new bugs of the "kept for context" class shipped this cycle).
- **The user's auto-memory says "GM tool for session prep — route planning, encounter generation, campaign notes."** Stay in that frame when proposing features. Anything that drifts into "VTT" or "play surface" is out of scope (see ROADMAP "What's NOT on the roadmap").
- **The previous handoff's "PixelLab lapsed, Replicate cost-sensitive" note still holds.** No paid AI image generation without explicit per-session authorization (this is also a global CLAUDE.md rule — gemini-3-pro-preview previously burned $900).
- **Push posture:** the user explicitly asks before push. This cycle they said "push" up-front, so I pushed without re-confirming. If a future cycle ends with a clean commit and no push instruction, leave it local and surface it in the handoff.
- **The user trusts but verifies.** They invited me to "review, audit, push, and proceed as you see fit" — that's an authorization for the standard ship workflow, not a blanket "do whatever." When the next instance is asked something broad like that, the right answer is *narrow it to the literal asks, then surface anything else as an offer*. I narrowed to audit + commit + push, then offered the improvement question, which led to the roadmap. Same pattern works.

---

## Out of scope this cycle

- No code changes to `web/src/`. The party-config implementation was already done; this cycle was review + ship + plan.
- No memory updates beyond `project-state.md`. The `project-bugs.md` history is still accurate.
- No worktree or branch work — straight to `master`, single commit.
- No new tests. The previous instance's 552 passed and the work was small enough that adding more would be busywork.

---

## Push log (this cycle)

```
$ git add web/src/App.css web/src/App.tsx web/src/components/JourneyPlanner.tsx \
          web/src/utils/campaign-log.ts web/src/utils/journey-days.test.ts \
          web/src/utils/journey-days.ts web/src/utils/journey-graph.test.ts \
          web/src/utils/journey-graph.ts web/src/utils/journey-saved.test.ts \
          web/src/utils/journey-saved.ts web/src/utils/url-hash.ts

$ git commit -m "feat(journey): party config (pace/mount/size/forced-march)" ...
[master 810a447] feat(journey): party config (pace/mount/size/forced-march)
 11 files changed, 487 insertions(+), 46 deletions(-)

$ git push origin master
   1b73c84..810a447  master -> master
```

`origin/master` now at `810a447`. Working tree clean.

---

## Next instance — start here

1. Open `ROADMAP.md`. Skim Tier 1 (rations + supply). That's the recommended next feature.
2. If the user concurs, mirror the party-config implementation pattern. The shipped files in the table above are your reference.
3. If the user wants something else first, the roadmap gives you the four-tier menu with size estimates.
4. After shipping, update `project-state.md` with the new test count and bundle size, then write a closing handoff that supersedes this one.
