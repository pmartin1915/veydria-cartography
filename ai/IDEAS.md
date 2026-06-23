# Deferred ideas

Append-only log of good ideas not worth folding in right now. Not `@`-imported (capturing costs nothing per turn). Sweep at session start / into handoffs.

Format: `idea — why deferred — where it applies`.

---

## experience-polish — deferred axes (2026-06-21)

The experience-polish arc has three axes; slice 1 (**branding chrome** — favicon, custom Tauri icons, About/version) is being built on `feat/branding-chrome`. The other two are scoped but deferred at Perry's direction:

- **First-run welcome experience** — a dedicated welcome screen / desktop-aware onboarding entry, better empty-state coaching (Session Prep + Saved Journeys + Campaign), surfacing the currently-hidden keyboard help (Shift+?), optional "what's new" on update. *Why deferred:* Perry prioritized the smaller branding-chrome win first; the existing tour engine (`tour.ts` + `TourOverlay.tsx`, 8-step main + 9-step journey tutorial) already covers a lot, so this is medium-effort polish, not a gap. *Where it applies:* `web/src/App.tsx` (tour launch + steps), `web/src/components/TourOverlay.tsx`, `web/src/components/KeyboardHelp.tsx`, the empty-state strings in `SessionPrepPanel.tsx` / `journey-planner/SavedJourneysPanel.tsx`, and a desktop-gated first-run branch keyed off `persistence/runtime.ts` `isTauri`.

- **Journey "Travel mode" (journey-as-game)** — the north-star (Oregon Trail × A Dark Room × GoT). Today the journey planner is a static, read-only GM planning tool: everything is computed up-front and shown at once. The turn-based play-loop machinery **already exists** — `nextDay(state, action)` with `Action = continue|rest|force-march|ration|reroute|turn-back`, `JourneyState`, `DayOutcome = in-progress|arrived|aborted` in `web/src/utils/journey-days.ts` — but it's wired only to the batch sim harness (`scripts/sim/`), never to the UI. Making travel *feel lived* = surfacing that API into an interactive mode: step day-by-day, choose an action, watch supply burn live, resolve encounters as choices, end on arrive / turn-back / perish, and save a playthrough (not just a plan). *Why deferred:* largest/most-ambitious axis — a genuine new feature with real architecture and UX design, not chrome; warrants its own dedicated phase. **Now specced:** Perry chose the Hybrid interactivity tier (2026-06-21) — full v1 spec with data model + acceptance criteria in `ai/PASSAGE-MODE-V1-SPEC.md`. *Where it applies:* new "Passage" mode in `web/src/components/journey-planner/`, consuming the existing `journey-days.ts` `nextDay`/`JourneyState` API; a small signature-encounter choice registry over today's read-only `encounters.ts` beats.

## Other carried-forward items

- **apple-touch-icon transparent corners** — `web/public/apple-touch-icon.png` (from `gen-icons.mjs`, `omitBackground:true`) has transparent rounded corners; older iOS composites those over black when the icon is added to the home screen. *Why deferred:* negligible for a GM desktop/web tool (iOS home-screen install is a non-use-case). *Fix if ever needed:* render that one target without `omitBackground` (solid `--bg-deep` square).

- **Desktop icon — not yet seen on an installed window** — the regenerated `src-tauri/icons/*` are verified compass-not-Tauri-logo at the file + `tauri.conf.json` level, but not confirmed on an actual running/installed window (Windows caches app icons aggressively). *Where it applies:* `npm run tauri build --debug` then check the window/taskbar icon; treat a stale icon as cache, not a regen failure.

- **Desktop file-export GUI round-trip — un-run** (from `tauri-desktop-app` memory): save PNG + campaign log to `D:\` in a real Tauri window, force one failure in a read-only dir, confirm the `SaveStatusIndicator` badge surfaces it. Merged on Perry's go (web fully verified; desktop export couldn't regress — it was already broken). *Where it applies:* `web/src/persistence/file-export.ts` + `tauri-file-export.ts`, `SaveStatusIndicator`.

## Passage v1.1 — findings from the playtester (2026-06-22)

The Passage playtester (`scripts/sim/sim-passage-report.ts`, run `npm run sim:passage`) plays the choice layer at scale via counterfactual forks. Three findings surfaced — the Passage v1.1 work list. *Why deferred:* Passage v1 just merged (PR #46); these are polish/balance for the next pass, not v1 blockers.

- **Death-march: the choice layer is gated behind supply survival, and reachability is highly play-dependent.** Under naive base players (`survive`/`headlong`) the party perishes BEFORE any signature choice in ~76–80% of standard-supply crossings (pure perishes — aborted is 0%, the policy never turns back). But the engine 5-policy `sim-fun-report` completes standard/cheapest ~42.8%, so skilled play roughly halves that. *Do not blanket-buff supply on the 80% figure* — it's the naive floor. The real lever is the known no-midpoint corridors (Highland-Steppe Corridor et al.) where water runs dry mid-leg, OR surfacing the death-march risk to the player before they set out. *Where it applies:* resupply midpoints in the route data / `journey-graph.ts`; or a pre-Passage "this route is a death march on your supply" warning. Re-measure with `npm run sim:passage` (and `--base headlong` for the band) after any change.

- **90% of dramatic beats are non-interactive.** 86 interactive (signature) vs 874 non-interactive moderate+severe beats across the full grid. The juiciest written encounters are flavor-only. Top promotion candidates by frequency: **Basin customs raid** (seize the scribe), **plague-quarantine** (fortnight's wait / forged seal / bribe), **sabkha sinkhole**, **Qalībin dry-wadi shortcut** (trust her? cut two days), **sand-wraith**. *Where it applies:* add `key` + a `SIGNATURE_CHOICES` entry in `web/src/utils/passage.ts` + `encounters.ts` for the promoted beats.

- **Repeated signature encounters are word-for-word identical.** When a key fires ≥2× in one crossing (bandits did in 2/480; e.g. Kheshkai→Irrah winter), the second presents the same options AND the same outcome prose ("the bandit-chief knows your manifest" twice). Also: under slack supply with end-of-route resupply, the bandits choices are *inert* (differentiation 0, impact 0 — all branches converge to identical arrival). *Where it applies:* vary prose/options per instance index in `passage.ts` `SIGNATURE_CHOICES` (e.g. an array of variant prose per key), and/or make at least one branch leave a lasting mark that resupply can't erase.

### Passage v1.1 — after slice 1 (promoted dry-wadi, customs-raid, plague-quarantine, sabkha-sinkhole, 2026-06-22)

- **Teeth slice (engine, the "both" second half).** Promoted choices are mechanically
  inert under slack supply because `risk` is cosmetic (`passageChoose` only logs it, never
  touches supply) and rations/water reset to full at every resupply node. customs-raid's
  "Give up the scribe" branch is the
  canonical case (pure narrative loss, 0/0/0). To make choices change outcomes under slack
  too: add a persistent "scar"/lasting-cost field to the engine that resupply can't erase,
  OR make grave-risk a real death chance. *Where:* `EncounterChoice.outcome` + the burn/
  resupply path in `journey-supply.ts` / `passage.ts`. Architecture — stays on Opus.
- **Death-march reachability (#1).** Naive players perish before any choice in ~76–80% of
  standard-supply crossings; lever is no-resupply corridors, not starting supply. Add
  resupply midpoints to corridor route data, or a pre-Passage "this route is a death march
  on your supply" warning. *Where:* route/graph data + JourneyPlanner.
- **sand-wraith** promotion (next batch of beats to signature choices).
- **Per-instance prose variation** for repeated keys (bandits fires 2x word-for-word in
  2/480 crossings). Vary prose/options by instance index in `SIGNATURE_CHOICES`.

### Passage v1.1 — after slice 2 (teeth: persistent capacity scar, 2026-06-23)

Shipped the deterministic **capacity-scar** mechanic: `EncounterChoice.outcome.scarRations`
/`scarWater` permanently lower the resupply ceiling (`JourneyState.scarRations`/`scarWater`,
subtracted in `applyDailyBurn`'s restore). Retrofit to `sabkha-sinkhole` "Cut the cart loose"
(`rationsDelta -2, scarRations 1`), rebalancing "Haul it out by rope" to `daysDelta 2,
waterDelta -4` so the fork is live (no dead/dominant flag; outcome-impact 4.3%→26.1%).

- **Design lesson (for future scar use):** a scarred branch paired against a *fully-transient*
  cost branch tends to be **dominated** wherever resupply happens (the scar persists, the
  transient cost recovers). To stay a live tradeoff, the *alternative* must carry real survival
  risk (lethal time/water in the tight pre-resupply corridor) so the scarred branch's speed wins
  on the arrival axis there. Tune via `sim:passage` dead/dominance flags, not blind values.
- **Headcount scar (person-loss lever) — deferred.** For branches whose loss is a *person*, not
  stores: `customs-raid` "give up the scribe", `bandits` "stand and fight" ("two of yours do not
  rise"). A `partyDelta` reducing traveler count affects both capacity and per-day consumption
  (a headcount cut perversely *helps* survival by removing a mouth, so it needs care). The
  natural sibling to the capacity scar; would make give-up-scribe finally bite.
- **Probabilistic grave-risk — deferred.** A real death roll on `risk: 'grave'`. More dramatic
  but breaks determinism (needs seeded rolls) and complicates the counterfactual fork. Revisit
  only if the deterministic scar proves insufficient for drama.
- **UI surfacing of a reduced ceiling — optional polish.** Label the supply ledger "max reduced"
  after a scar. Current numbers already drop visibly post-resupply, so low priority.
