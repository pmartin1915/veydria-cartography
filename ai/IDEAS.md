# Deferred ideas

Append-only log of good ideas not worth folding in right now. Not `@`-imported (capturing costs nothing per turn). Sweep at session start / into handoffs.

Format: `idea — why deferred — where it applies`.

---

## experience-polish — deferred axes (2026-06-21)

The experience-polish arc has three axes; slice 1 (**branding chrome** — favicon, custom Tauri icons, About/version) is being built on `feat/branding-chrome`. The other two are scoped but deferred at Perry's direction:

- **First-run welcome experience** — a dedicated welcome screen / desktop-aware onboarding entry, better empty-state coaching (Session Prep + Saved Journeys + Campaign), surfacing the currently-hidden keyboard help (Shift+?), optional "what's new" on update. *Why deferred:* Perry prioritized the smaller branding-chrome win first; the existing tour engine (`tour.ts` + `TourOverlay.tsx`, 8-step main + 9-step journey tutorial) already covers a lot, so this is medium-effort polish, not a gap. *Where it applies:* `web/src/App.tsx` (tour launch + steps), `web/src/components/TourOverlay.tsx`, `web/src/components/KeyboardHelp.tsx`, the empty-state strings in `SessionPrepPanel.tsx` / `journey-planner/SavedJourneysPanel.tsx`, and a desktop-gated first-run branch keyed off `persistence/runtime.ts` `isTauri`.

- **Journey "Travel mode" (journey-as-game)** — the north-star (Oregon Trail × A Dark Room × GoT). Today the journey planner is a static, read-only GM planning tool: everything is computed up-front and shown at once. The turn-based play-loop machinery **already exists** — `nextDay(state, action)` with `Action = continue|rest|force-march|ration|reroute|turn-back`, `JourneyState`, `DayOutcome = in-progress|arrived|aborted` in `web/src/utils/journey-days.ts` — but it's wired only to the batch sim harness (`scripts/sim/`), never to the UI. Making travel *feel lived* = surfacing that API into an interactive mode: step day-by-day, choose an action, watch supply burn live, resolve encounters as choices, end on arrive / turn-back / perish, and save a playthrough (not just a plan). *Why deferred:* largest/most-ambitious axis — a genuine new feature with real architecture and UX design, not chrome; warrants its own dedicated phase. **Now specced:** Perry chose the Hybrid interactivity tier (2026-06-21) — full v1 spec with data model + acceptance criteria in `ai/PASSAGE-MODE-V1-SPEC.md`. *Where it applies:* new "Passage" mode in `web/src/components/journey-planner/`, consuming the existing `journey-days.ts` `nextDay`/`JourneyState` API; a small signature-encounter choice registry over today's read-only `encounters.ts` beats.

## experience-polish — Passage onboarding SHIPPED (2026-06-24, branch `feat/passage-onboarding`, commit cec91fe, NOT merged)

Filled the "proceed along the road" half of the [[journey-experience-vision]] north-star. Ground
truth at start: ocean styling, an on-map Map Key, and a 9-step journey **planning** tutorial were
already shipped (the older "no tutorial / no legend" notes were stale) — but onboarding never
mentioned **Passage** (the day-by-day travel game), so the crown feature was invisible to a
first-time GM. Two pieces, reusing the existing tour engine (`tour.ts` reducer + `TourOverlay`):

1. **Bridge step** — a 10th journey-tutorial step spotlighting the "Set out" button
   (`data-tour="journey-set-out"` in `JourneyResults.tsx`).
2. **Passage tutorial** — a new 4-step tour (welcome/ledger/actions/journal) auto-firing once on
   first Passage entry, gated by `PASSAGE_TUTORIAL_KEY`, guarded against share/mobile/active-journey-
   tutorial/prior-completion. Anchors in `PassageMode.tsx`. New key added to both e2e addInitScripts.

Built via /orchestrate (Opus spec+review, Kimi impl in worktree). 956 unit tests, tsc + build green,
Playwright visual check confirmed correct spotlight anchoring under `.passage-mode`.

**Useful gotcha discovered (don't re-litigate):** the tour **backdrop blocks ALL clicks** —
`.tour-backdrop` is full-screen `pointer-events:auto`; `.tour-spotlight` is `pointer-events:none`
and purely visual (a box-shadow ring), NOT a clickable cutout. So spotlighting a live button shows
it but does NOT make it clickable mid-tour; the user must use the card's Done/Next. We worried
step 10's spotlighted Set out button would be a "click-trap" (clicking it mid-tour would suppress
the passage tutorial via the `tutState.active` guard) — **empirically verified it cannot happen**,
the backdrop intercepts the click. The Done-to-proceed flow is CSS-enforced, not just convention.

**Deferred (v1 scope):** no replay entry point for the Passage tutorial (it needs Passage active to
have anchors; auto-fire-once on first entry only). If wanted later, add a replay trigger that first
enters a demo Passage, or surface it from KeyboardHelp only while `passageActive`.

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
subtracted in `applyDailyBurn`'s restore). Mechanism is built, unit-tested, byte-neutral at
scar=0, and reusable. Retrofit (weak demo) to `sabkha-sinkhole`: "Cut the cart loose"
`rationsDelta -2, scarRations 1`; "Haul it out by rope" rebalanced to `daysDelta 2,
waterDelta -4, risk grave`. No dead/dominant flag; outcome-impact 4.3%→26.1%.

- **Honest read of the sabkha demo (don't inherit "teeth works, choices bite under slack" as
  settled — it mostly doesn't yet).** The scar barely moved "Cut": completion 65.2%→65.2%,
  arrived 15→15, perished 8→8; it only dropped Cut's ending rations ~1. The liveness + the
  impact jump came almost entirely from nerfing **Haul** into lethality (an arrival-axis
  effect that needed no new mechanic). Under slack a 1-ration ceiling cut is still ~inert (it
  can't bind where supply doesn't bind). The cautious baseline *always cuts*; Haul is the
  high-variance road-not-taken (wins 16/23 if survived, perishes 14/23).
- **The scar's real role (and where it'll actually shine).** On sabkha it's the slack-side
  counterweight that keeps Cut from flagging dominant — load-bearing but not the headline. A
  scarred branch paired against a *fully-transient* cost branch is **dominated** wherever
  resupply happens (scar persists, transient recovers), so sabkha's geometry forced the
  liveness to come from the alternative's lethality. The scar will be the **load-bearing
  differentiator** on a beat where the *permanent loss is the natural headline cost AND the
  alternative is not a death-gamble* — e.g. a "pay a permanent price to skip a delay" choice
  with no perishing involved. Find/author that beat to truly prove the mechanic.
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

### Passage v1.1 — slice 3 (scar-headline beat: "The Switchback", 2026-06-23) — RESOLVED

Authored the beat the slice-2 note asked for ("permanent loss is the headline cost, alternative
is not a death-gamble"): `switchback` — `Stave the water-casks` (scar) vs `Double-team the climb`
(`daysDelta 2`, no scar). This **closes the "find/author that beat" action above** and proves the
scar mechanic cleanly. Two findings worth keeping:

- **The scar must hit the *binding* resource — this is the real lesson.** First attempt used
  `scarRations 2`. It "registered" (rations-range 2.0) but was **inconsequential**: the sim economy
  is 12 rations / 6 water per person (`passage-run.ts`), so rations are slack and water binds. With
  scarRations the party finished with ~10 rations either way and the *days* on the other branch
  carried the choice — sabkha redux, polarity flipped (Double-team became the death-gamble: 39%
  completion, 61% perish). Pivoting the scar to **`scarWater 2`** put it on the resource that
  actually binds. Result (full grid, headlong, all modes/seasons, 75 instances): water-range **2.0**,
  outcome-impact **18.7%**, no dominance/dead flags, and perish rates *close* (Stave 40% / Double-team
  51%) — drama from the scar, **not** a lethal alternative. Verify-the-logic check: zero the scar and
  Stave becomes free speed → strictly dominates → flagged; the scar is the counterweight that makes
  speed cost something.
- **It's live-but-*leaning*, not 50/50 (don't oversell).** Double-team leads dominance 61% full-grid
  / 75% summer (16-instance sample). Among two-branch beats that's harder than its peers (dry-wadi
  23%, sabkha 48%); the 3-branch beats' leading branch also sits ~48%. So Stave is the **situational
  speed-play / "mortgage your margin" shortcut**, taken when you're behind — not a coin-flip. No flag
  trips, so it's a legitimate live choice; left un-retuned on purpose (tuning scarWater 1↔2 just
  trades signal strength for balance and over-fits the headlong policy).

Two structural notes discovered while building this:
- **Signature beats must live in `TRADE_ROUTE_BEATS` (or `INTRA_CIV_BEATS`), NOT `CHOKEPOINT_BEATS`.**
  A switchback first went in `CHOKEPOINT_BEATS` (thematically perfect — that pool is *for* mountain
  passes). It generated 16× but was **reached as a live choice 0×**: chokepoint segments are never hit
  in-progress by any base policy in this route graph (the other signature beats are all trade-route /
  intra-civ). Moving it to `TRADE_ROUTE_BEATS` → 75 instances. *If a future signature beat shows
  `N instances = 0` while Repetition > 0, this is why.*
- **Theming wart (known, acceptable — not fixing):** `switchback` is biome-gated `Escarpment`, but
  `filterByBiome`'s fallback returns the *full* pool on any segment whose biome has no trade-route
  beat, so it leaks onto other biomes (fires 108×/960, not Escarpment-rarity). Mostly high terrain
  (Mountain/Highland/Gorge/Afroalpine) where a switchback still fits; occasionally Plains/undefined
  where it reads slightly off. Same mechanism as *every* biome-tagged trade beat (sabkha, oasis, …) —
  a pre-existing pattern, not new debt. Fixing would require a stricter biome filter for signature
  beats; deferred.

The **headcount lever** (above) is still the natural next mechanic — it bites via daily *consumption*,
not the resupply ceiling, so it doesn't depend on which resource is slack.
**[RETRACTED 2026-06-23 — see below: not buildable in a per-capita supply model.]**

---

### 2026-06-23 — headcount lever is NOT buildable as imagined; pre-merge retune pass (no numeric change)

**Headcount lever — retracted.** Verified from source: `party.size` is cosmetic (read only in
`describeParty()`, `journey-days.ts:159`) and the whole supply model is **per-capita** — supply is
tracked per-person (`rationsPerPerson`/`waterPerPerson`) and burn is per-person-per-day
(`applyDailyBurn`, no headcount term). Runway = supply ÷ burn-rate; both scale linearly with N, so
losing a person leaves runway **unchanged** (their share leaves with them) or **improves** it (their
share stays in the pool — the scar inverts to a *boon*). There is no per-capita variant where losing
a person *costs* supply-days. The premise above ("bites via daily consumption") is false. The only
coherent realization is a **burn-rate scar** (bump `encMult` → multiplies both resources → bites
whichever binds) — but that is **unbounded** (compounds with route length), re-introducing the
death-gamble dynamic slices 2–3 fought to escape. Per-session decision (2026-06-23): **not building
it.** The capacity-scar is already proven on a binding axis (water) and shown inconsequential on a
slack one (rations); that's a complete mechanic.

**Pre-merge retune pass — verdict: balance-clean on dominance/lethality, NO numeric change warranted;
but "merge-ready" is qualified.** Re-measured the full grid (480 crossings) on **both** policies —
`--base survive` and `--base headlong` (the over-fit trap is policy-sensitivity). Findings:

- **switchback — leave as-is, now data-backed.** headlong: 50/50 completion, Double-team 59%
  dominance (*inside* the ≤60% target), perish 17/17 dead-even. survive: 73% (the cautious policy
  correctly preferring the safe slow climb). No flag, no death-gamble. Every candidate tweak fails the
  "don't help one policy while hurting the other" test: anything that pulls survive's 73% down flips
  headlong's already-good 59% (lower `scarWater` → Stave becomes near-free speed → dominates; +days on
  Double-team → over-fits survive, flips headlong). The prior "tuning over-fits" call is **confirmed**,
  not just asserted.
- **sabkha — no flag, but the *weaker* scoped beat (honest).** The scar option (Cut) is the *safer,
  higher-completion* choice; Haul is the risky "keep your stuff if you survive" play. Coherent
  risk/reward — BUT Haul perishes 86% vs Cut 64% (headlong), which is **not** the close perish-band the
  death-gamble guard names. "No dominance flag" ≠ "balanced coin-flip." Left un-tuned (a tweak here is
  the same over-fit trap), characterized honestly.
- **plague-quarantine — watch-item.** "Hold at the cordon" (`daysDelta 12`) is 0% completion / 100%
  perish on both policies; dead-freq 73% (survive), just under the 80% flag. Thematically a doomed
  option behind a real 2-live-choice structure (Buy seal vs Salt-track), so not tripping the gate — but
  it's the closest beat to a flag.
- **ford — n=1 artifact.** Trips DOM+DEAD under survive, but only on **1 instance** (fires 4×/480, the
  rarest beat); clean under headlong (n=2). A small-sample reporting artifact, not a tunable imbalance.

**Bigger latent issue surfaced (separate axis, out of this pass's scope): three beats are
UNDIFFERENTIATED** — the choice doesn't change the outcome (outcome-impact 0%, water/rations range 0):
- **fever** — three options with genuinely different deltas (−2 rations / −3 water / +2 days), but it
  fires in **slack-supply** contexts (all branches end at the 13/19 caps), so nothing bites. Same
  lesson as the scar: a cost only matters on a *binding* resource at a *binding* time.
- **dry-wadi** — −2 water (faster) vs +2 days (keeps water) are calibrated to wash out (both branches
  47/47% survive, identical final supply).
- **bandits** — 0/0 differentiation likewise.

This is a **choice-quality** defect, orthogonal to the dominance/lethality balance, and it's the exact
pathology the scar mechanic exists to fix ("the choice has to bite"). **Fixing it is a redesign** (give
these beats scar-like teeth, or gate them to binding conditions) the user did NOT scope here — deferred.
It bears on the held merge decision: slices 1–3 are *balance*-clean but the v1.1 choice set still has
fake choices (fever/dry-wadi) that pre-date the scar work.

Verification: 950 tests pass, `tsc --noEmit` clean. Reports at `output/sim/passage-{survive,headlong}.md`
(gitignored). No code change this pass — `feat/passage-teeth` stays local, unpushed, unmerged.

---

## Passage v1.1 — Slice 4: dry-wadi gains teeth (scar); supply-threshold GATE tried + reverted (2026-06-23)

`feat/passage-teeth` merged to master first (balance-clean). This slice on `feat/passage-gating`.

**Shipped: dry-wadi is no longer a fake choice.** "Trust her, take the wadi" changed from a transient
`waterDelta −2` to a permanent `scarWater 2` (a cask cracked and lost on the descent); "Stay on the
mapped trail" unchanged (`daysDelta 2`). The discriminating signal is **differentiation** (max−min
final supply across branches), NOT outcome-impact — the latter is sample-noise at these n (see metric
caution below). Result, full grid, both base policies:
- **headlong (the solid case): differentiation 0/0 → 2.0 water / 0.8 rations** across 30 instances;
  outcome-impact 0% → 13.3%; no dominance/dead flags.
- **survive (genuinely marginal): differentiation 0/0 → 0.2 water / 1.0 rations** across 19 instances;
  outcome-impact 0% → 10.5%; no flags. The split surfaces in *rations*, not water, despite the scar
  being on water: survive rations at ≤2, so a lowered water ceiling converts into *earlier rationing* →
  the pressure shows up as rations/time, not final water. Real but thin (water-range 0.2, n=2/19).
  **headlong is where the scar bites cleanly; survive is marginal — "no flag" ≠ "balanced both ways."**
- No regression elsewhere (only pre-existing flag is ford's n=1 survive artifact). 951 tests, `tsc` clean.

**The headline finding — recorded so no future session re-attempts it: a supply-THRESHOLD gate cannot
fix a slack-timing fake choice.** The plan was to *gate* dry-wadi (fire the choice only when water
binds) rather than scar it, to avoid a switchback echo. Built the gate (`SupplyGate` type +
`SIGNATURE_GATES` map + `gatePasses` + a check in `signatureForDay`, shared by app and sim) and measured
it. **It does not work, and the reason generalizes:**
- At `atOrBelow` 3 and 5, on *both* policies, dry-wadi stayed **0% outcome-impact, differentiation
  exactly 0.0** — branches end at *identical* supply. A transient −2 water is **refilled at the next
  resupply node regardless of *when* it is spent**, so no firing-time threshold can make it stick. Only
  a *persistent* cost (scar) survives resupply. This is the same resupply-erasure that makes the choice
  fake in the first place; gating moves *when* the cost lands, not *whether* it persists.
- dry-wadi additionally collapses to a **single axis** (both branches trade only water: −2-now vs
  +2-days-of-burn), so even asymmetric deltas yield *dominance*, not divergence. Scar-vs-days is the
  **only** stable live form for it — structurally a switchback echo, unavoidably. The "clone" worry is
  aesthetic; the contexts differ (escarpment/severe vs trade-route/opportunity), and a recurring
  "permanent-water-price vs time" motif is acceptable. **Per-session decision (2026-06-23): accept the
  scar; revert the gate** (simplicity-first — unused, and unproven on its real target).
- **The gate is NOT proven infra for fever/bandits.** Those are 3-branch and were never gated in any
  measured run. A supply-*threshold* gate may still not fire in the *no-resupply-ahead* window that is
  the only place a transient cost sticks — so fever/bandits likely need a **resupply/position-aware**
  gate (e.g. "no resupply node between here and the destination"), not a supply-threshold one. Revisit
  there, and expect cost-rebalance too (gating fever on "water binds" makes its cheap-rations "Pay"
  branch dominant — a dead/dominated-option trap on 3 branches).

**Metric caution for the next session — read DIFFERENTIATION, not outcome-impact, to judge "fake."**
In these same reports fever shows outcome-impact **16.7% (survive) / 14.3% (headlong)** — do NOT read
that as "fever is already live, skip it." Those are **n=1/6 and 1/7 sample artifacts**; fever's
differentiation is still **0.0/0.0** (all branches end at identical supply), so it is still a fake
choice. outcome-impact is a coarse fraction-of-instances count and goes noisy below ~20 instances;
differentiation (final-supply spread across branches) is the metric that actually discriminates.

**Still open (unchanged from slice-3 note):** fever and bandits remain undifferentiated fake choices
(differentiation 0.0/0.0). The right tool is the resupply-aware gate above (+ per-branch cost rebalance),
not the scar (a scar on one of three branches is the dominated/dead-option trap — see sabkha). Deferred
to a dedicated slice.

Verification: 951 tests pass, `tsc -b` clean. Reports at `output/sim/passage-{survive,headlong}.md`
(gitignored). `feat/passage-gating` merged to master on completion.

**Follow-up shipped same day — scar LEGIBILITY (closes the parked "UI surfacing of a reduced ceiling"
item).** With three beats now carrying scars (switchback/sabkha/dry-wadi), the lowered resupply ceiling
was invisible in the Passage ledger — a later resupply quietly refilled to a smaller number with nothing
on screen explaining why. Extracted `PassageLedger` (exported from `PassageMode.tsx`); when
`scarRations`/`scarWater > 0` it shows the lowered **cap Nd** + a **−K** amber delta (distinct from the
red transient-debt tag), with a GM-facing tooltip. 954 tests (+3 `PassageMode.test.tsx`), `tsc -b` + web
build clean. Unit-verified in isolation; the at-the-table visual is Perry's to confirm on the next run
(forcing a scar in-app is RNG-gated, so not auto-screenshotted). Pushed to master.

---

## Passage v1.1 — Slice 5: fever + bandits VERIFIED unfixable cheaply; closed as flavor (2026-06-24)

The handoff proposed the slice-4 plan for the "last fake choices": a **resupply/position-aware
gate + per-branch cost rebalance**, with the explicit instruction to *verify the premise first*
and judge by **differentiation, not outcome-impact**. Verification killed the premise. **No
engine change shipped — and that is the correct outcome, not an incomplete one.**

**What the metric was hiding (the real product of verifying first).** The "fever/bandits are
0.0/0.0 fake choices" verdict was a **median artifact**. The fork harness already plays each
branch to completion, so it already captures no-resupply-ahead windows — it just reported only
the *median* range, which is 0 whenever <50% of instances differentiate. Added a permanent
diagnostic to `sim-passage-report.ts` / `passage-run.ts` (`PerKeyAggregates`): **max range**,
**biting%** (fraction of instances with either resource range ≥ 2), and a **tail split** —
biting instances by terminal-outcome composition: `allArrive / mixed / allPerish` — plus
**live%** = `allArrive ÷ all instances`. allArrive is the *only* slice that is a genuine
recurring tradeoff (every branch arrives, with different leftover = a true no-resupply-ahead
window). `mixed` is a death-cliff (≡ outcome-impact); `allPerish` is dead-march noise.

**The decisive numbers (full grid, 480 crossings, `--base survive`):**

| key | instances | med | max water/rations | biting% | tail (arr/mix/perish) | **live%** |
| --- | --- | --- | --- | --- | --- | --- |
| **bandits** | 43 | 0.0/0.0 | 13.1 / 25.3 | 21% | **0 / 3 / 6** | **0%** |
| **fever** | 6 | 0.0/0.0 | 14.0 / 8.1 | 17% | 0 / 1 / 0 | **0%** |
| customs-raid | 30 | 0.0/0.0 | 16.3 / 25.3 | 43% | 1 / 4 / 8 | 3% |
| switchback (scarred) | 22 | 2.0/0.0 | 9.7 / 10.4 | 86% | 14 / 2 / 3 | **64%** |
| dry-wadi (scarred) | 19 | 0.2/1.0 | 16.0 / 19.5 | 63% | 7 / 2 / 3 | **37%** |

- **bandits live% = 0%.** Of its entire 21% biting tail, *zero* instances are the all-arrive
  gradient — it's 3 death-cliffs (= the 7% outcome-impact) + 6 dead-march noise. Whenever all
  branches arrive they arrive at *identical* supply: there is **no natural no-resupply-ahead
  window for bandits in the canon grid.** A position-aware gate would therefore have **almost
  nothing to gate *to*** — it would suppress the choice to flavor in ~all firings, not make it
  live. (This supersedes the slice-4 prediction that a resupply-aware gate "likely" fixes
  fever/bandits: measured, it doesn't, because the target window doesn't occur.)
- **fever is unjudgeable.** n=6 (8 fires / 480), far below IDEAS.md's own ~20-instance noise
  floor. "Don't ship an untestable balance change" — leave as flavor, full stop.
- **The transient-vs-scar dead-choice rule, now stated cleanly (generalizes the slice-2/4
  notes).** A scarred branch arrives *below* cap whenever resupply lies ahead, so against a
  recoverable-transient sibling it is **strictly worse → dominated → a dead choice** in the
  79%+ wash-out regime. The terrain beats (switchback/dry-wadi/sabkha) escape this *only*
  because their alternative is `+days` — also non-recoverable — so neither branch washes out.
  So "2B done right" for bandits isn't one scar field; it's **redesigning all three branches to
  persistent/time costs on different axes** (illustratively: toll = scarRations, fight =
  scarWater + grave, parley = +days). That is a *beat redesign + sim-tune*, and the live%=0%
  data says there's no natural window to justify manufacturing one. Not done.
- **customs-raid (43% biting, 3% live) is the same class, and was never flagged** — confirming
  the median-0.0 framing was always about measurement, not these two beats specifically. The
  whole transient-cost family (ford/customs-raid/plague/bandits/fever) is live only via
  occasional death-cliffs, not recurring gradients. If a future session ever wants any of them
  reliably live, the lever is the all-persistent-branch redesign above, not a gate.

**Decision (2026-06-24): close #2 as flavor.** fever + bandits are *contextually live* (they
bite as rare death-cliffs) but have no recurring tradeoff window; forcing one would either ship
a dead choice (naive scar) or manufacture a window the data says isn't there (full redesign /
gate), for beats already well-served by the three scarred terrain choices. **Kept** the
max/biting/live diagnostic — it is the metric that should have existed (it catches the next
"median says fake" mirage) and is unit-tested (`passage-run.test.ts`). Engine, `passage.ts`,
and the choice set are **unchanged**. The position-aware-gate idea from slice 4 is hereby
**retired**, not deferred — measured and found inapplicable.

Verification: tests + `tsc -b` + web build green; report at `output/sim/passage-report.md`
(gitignored).

---

## Oregon Trail '88 mode — Veydria skin (2026-07-01)

**Perry's vision:** A dedicated game mode that emulates the 1988 Oregon Trail game almost exactly
in structure and feel, but with Veydria lore and visuals throughout. Not a loose spiritual
successor — the loop, the screens, the stakes all map 1:1 to OT '88.

**Why deferred:** This is a major arc — effectively a second game mode sitting alongside Passage
(which is more A Dark Room / choice-card). Warrants its own spec and Perry's sequencing decision.

**Where it applies:** New top-level mode, likely `web/src/components/journey-planner/TrailMode.tsx`
or equivalent, consuming the existing `journey-days.ts` + `journey-supply.ts` engines where
natural. Passage's canvas can be borrowed from (biome backdrops, TravelVignette silhouettes) but
the visual frame is new.

### OT '88 → Veydria mapping (first-pass)

| OT '88 mechanic | Veydria equivalent |
|---|---|
| Scrolling landscape (side-scroller) | Animated biome backdrop (extends TravelVignette's SVG idiom but scrolling, not static) |
| 5 party members with names | Named Veydrian travelers with civ/role tags (e.g. Kheshkai scout, Irrah caravan leader) |
| Food / clothing / ammo / spare parts / money | Rations / water / trade-coin / draft-animal condition (map to existing SupplyConfig axes) |
| Daily pace (grueling / strenuous / steady / easy) | Direct / Fastest / Safest / Cheapest (already exists as `mode`) |
| Rations level (filling / meager / bare bones) | Direct mapping to existing ration slider |
| Random events (disease, breakage, weather) | Veydrian ailments: desert fever, salt-sickness, dune-cough, river murrain; wagon = draft-animal lameness; weather = sandstorm / flash flood / harmattan |
| River crossing decision (ford / caulk / ferry / wait) | The existing `ford` signature beat + Halkar Strait crossing — expand to full OT river-screen |
| Hunting mini-game | Biome-gated "hunt" action: oryx in Irrah, reef fish in Oravan, ibex in Kheshkai highlands; yields rations |
| Fort / trading post | Waypoint resupply at existing canon nodes (Tavakh-Rubāṭ, Hākkar, etc.) with inventory trade screen |
| Party member death notification | Grave-marker screen with Veydrian epitaph ("Here lies ___, who died of salt-sickness east of the Sabkha Corridor. Day 14.") |
| Tombstone with name and cause | Canon death causes drawn from existing encounter pool prose; grave icon from existing map marker set |
| Final score / rank | Arrival with party count + supply surplus; civ-appropriate rank label (e.g. Irrah: "Master Azalai") |

### New vs reused

- **Reuse**: `journey-days.ts` engine (nextDay / applyDailyBurn / resupply), `journey-supply.ts`,
  existing biome/season data, TravelVignette backdrops, encounter prose, canon node names.
- **New**: scrolling landscape renderer, per-member health model (OT tracked 5 individuals not
  aggregate health), hunting action + simple shooting mechanic (even a dice-roll without animation
  captures the OT feel), fort trade screen, death-notification screen with grave, final-score/rank
  screen.

### Key design decision for the spec

OT '88 tracked **individual party members** — each person could get sick, die, and leave a named
grave. The current Passage model is fully aggregate (supply per person, no individuals). Switching
to per-member health means a new data structure on top of `JourneyState`. Options:
- **Shallow:** N named slots, each with a `health: 'well' | 'ill' | 'very ill' | 'dead'` flag;
  illness/death driven by existing encounter severity; supply model stays aggregate (OT '88
  actually is aggregate too — "you have X lbs of food" not "each person eats Y").
- **Full:** Per-member hunger + illness cascades; the real OT model.
  Shallow is probably right for v1 — delivers the drama (named deaths, graves) without
  rebuilding the supply engine.

**How to approach:** Opus spec + /orchestrate for the view layer. Architecture (per-member health
model) stays on Opus before any implementation.

## 2026-07-02 — hex-overlay fractional-zoom quantization (from coords-UI review)

**Idea:** `hex-overlay.ts` `reproject()` probes scale with 1-SVG-unit spans; `latLngToLayerPoint`
returns integer-rounded points, so at the app's half-level zooms (zoomSnap/zoomDelta 0.5) the
hex grid's scale quantizes (1.414 → 1) and the grid misaligns ~41% until the next integer zoom.
**Fix:** probe across the full 1200/800-unit extent and divide (exactly the fix applied to
`graticule-overlay.ts` + `scale-control.ts` in PR #50 — copy it over, ~4 lines).
**Why deferred:** hex-overlay was a frozen file during the orchestrated coords batch; fix belongs
on its own small branch off master after PR #50 merges. Found via Playwright zoom probing 2026-07-02.

## 2026-07-02 — Trail feel-check follow-ups (from live-UI feel-check session)

Driving 7 configs through the real Trail UI via a scratch Playwright script (deleted after use;
see `web/e2e/smoke.spec.ts` for the reusable tour-suppress + hash-navigation pattern) surfaced
three things worth a small follow-up, none blocking:

- **No dev seed hash param for Trail.** `TrailMode` accepts an `initialSeed` prop, but
  `JourneyPlanner.tsx:848-858` never wires it and `url-hash.ts`'s `ViewportState` has no seed
  field — every live run gets `Date.now() >>> 0`, so a Trail run can never be reproduced from a
  URL (Passage and the sim harness can both be seeded; Trail can't). *Fix:* add a
  `trailSeed`/`?seed=` hash param the same way `supplyRations`/`supplyWater` are wired, gated to
  dev/debug use. *Where:* `web/src/utils/url-hash.ts` (new field + parse/build), `App.tsx:1846`
  area (pass through as `initialSeed`), `JourneyPlanner.tsx` (thread to `TrailMode`).
- **`sim-trail-report.ts`'s `ROUTE_PAIRS` "short" route may be silently broken.** It targets
  `to: 'basin'` (`scripts/sim/sim-trail-report.ts:59`), but the real node id in
  `veydria-spatial.geojson` is `aethelian_basin` — confirmed by hand when the live-UI driver's
  identical hash param 404'd on `#journeyFrom=irrah&journeyTo=basin`. If `findRoute` silently
  no-routes on an unknown id rather than throwing, the "short" cell of every past
  `sim:trail-report` calibration grid may have been running against a null/degenerate route this
  whole time. *Fix:* change the literal to `'aethelian_basin'` and re-run one report to confirm
  the "short" row's numbers actually move.
- **Promote the scratch driver to a real committed Trail smoke test.** No committed Playwright
  spec drives Trail today (`web/e2e/smoke.spec.ts` only covers Passage). The scratch version
  (hash-navigate directly into a computed route + preset supply, walk via `trail-action-continue`
  resolving `trail-choice-*`/`trail-fort-choice`/`trail-ford-choice`, assert `.trail-score-screen`)
  is a straightforward adaptation of the existing Passage test at `smoke.spec.ts:357-407`. *Why
  deferred:* this session's version was intentionally verbose/observational (dumps full JSON per
  run), not assertion-shaped; a committed version needs trimming to a single bounded-walk
  assertion. *Where:* new `web/e2e/trail.spec.ts`.
