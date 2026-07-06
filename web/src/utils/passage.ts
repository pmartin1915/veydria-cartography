/**
 * passage.ts — Passage mode: the journey played day by day
 *
 * A thin, PURE wrapper over the existing journey engine (`journey-days.ts`).
 * Atlas mode plans a route; Passage mode lives it. The play-loop machinery
 * (`nextDay`/`JourneyState`) already exists and is unit-tested; this module
 * surfaces it to a human, adds a small branching-choice layer over signature
 * encounters, and detects the three player-facing endings.
 *
 * Design seams (kept deliberately small and additive):
 *
 *  - The engine is never modified and never mis-stepped. `journey-days.ts`
 *    stays byte-for-byte stable so Atlas mode and the sim harness are untouched.
 *
 *  - Signature encounters are identified by their canon `key` (added to a few
 *    beats in encounters.ts). `key` is robust where text-matching is not: the
 *    time-of-day overlay rewrites an encounter's `text`, but `makeEncounter`
 *    sets `key` unconditionally. A signature encounter's engine-side supplyCost
 *    is zeroed at init so the player's CHOICE owns 100% of its supply movement
 *    (the engine already bakes encounter supplyCost into the day's burn; letting
 *    a choice delta stack on top would double-charge invisibly).
 *
 *  - `EncounterChoice.outcome` has two non-overlapping channels:
 *      • rationsDelta / waterDelta — a ONE-OFF, absolute movement applied once
 *        at the moment of choice (the bribe paid, the cargo lost to the river).
 *      • daysDelta — N synthetic "wait" days. The engine cannot model added time
 *        (its totalDays is fixed and position is a pure function of the day
 *        index, so stepping it would teleport the party and still arrive on the
 *        original final day). Instead each waited day is a Passage-owned journal
 *        entry whose burn is computed by calling the engine's exported, pure
 *        `applyDailyBurn` directly with rest mods. The engine is never stepped.
 *
 *  - Endings: `arrived` / `aborted` come straight from the engine. `perished`
 *    (forced back) is owned here: the engine lets supply run negative as "debt"
 *    and never self-terminates, so Passage declares a perish once water or ration
 *    debt crosses a named floor (water is the more lethal of the two).
 *
 * Determinism: the engine's events stay seeded; only player CHOICES branch. Same
 * route + same choice sequence → identical final state (no Date/Math.random here).
 *
 * v1 simplifications (intentional, documented so they aren't mistaken for bugs):
 *  - Calendar events (`day.dayOfYear`/`calendarEvents`) are derived from the
 *    engine day, so they do not advance across synthetic wait days. Fine for
 *    ephemeral, GM-run v1.
 *  - Signature encounters surface on a `continue` step (the normal advance).
 *    A deliberate rest/force-march/ration past one is not interrupted.
 *  - If two signature encounters land on the same day, the first is presented.
 */

import {
  initJourneyState,
  nextDay,
  type JourneyState,
  type JourneyStateOpts,
  type Action,
  type JourneyDay,
} from './journey-days'
import { applyDailyBurn, getResupplyTier, type SupplyDay } from './journey-supply'
import type { RouteMode } from './journey-graph'
import type { Encounter } from './encounters'

/* ─── Choice data model ─── */

export interface EncounterChoice {
  /** Button label, e.g. "Ford now" / "Wait out the flood". */
  label: string
  outcome: {
    /** One-off, absolute supply movement applied once at the choice (usually negative). */
    rationsDelta?: number
    /** One-off, absolute water movement applied once at the choice (usually negative). */
    waterDelta?: number
    /** Permanent reduction to the party's resupply CEILING (positive = lower max).
     *  Unlike rationsDelta/waterDelta this is NOT erased by resupply — it lowers what
     *  every future resupply restores to. Use for irreversible losses (a lost cart). */
    scarRations?: number
    /** Permanent reduction to the party's resupply CEILING (positive = lower max).
     *  Unlike rationsDelta/waterDelta this is NOT erased by resupply — it lowers what
     *  every future resupply restores to. */
    scarWater?: number
    /** Days spent waiting/detouring. Realized as N synthetic wait entries, each
     *  burning a rest-day rate. NOT arithmetic on the engine's day counter. */
    daysDelta?: number
    /** Grave little paragraph shown when this branch is taken. Em-dash-free (VOICE-SPEC Option B). */
    narrative: string
    /** Flavour/severity hint for the UI; does not itself change supply. */
    risk?: 'none' | 'minor' | 'grave'
  }
}

/**
 * Registry: canon encounter `key` → branching choices. Only encounters whose
 * `key` appears here are "signature" (interrupt travel with a choice + have
 * their engine supplyCost zeroed). Everything else resolves via base actions.
 *
 * Prose is worldbuilder VOICE-SPEC Register D (dramatized scene), in second person
 * (the party is the POV): tension carried by a named count (rations/water/days),
 * em-dash-free (Option B), only attested morphemes (Irrah, Ngaru-Bon, Tavakh Qarat,
 * salt-cube, letters of credit), all already present in the source beats.
 */
export const SIGNATURE_CHOICES: Record<string, EncounterChoice[][]> = {
  ford: [
    [
      {
        label: 'Ford now',
        outcome: {
          rationsDelta: -2,
          risk: 'minor',
          narrative:
            'The rope holds. The current does not forgive the slow. You cross wet to the chest and lose a sack of meal to the brown water.',
        },
      },
      {
        label: 'Wait out the flood',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            'You make camp above the waterline and wait. The flood drops on the third morning and the crossing is easy. The waiting was not.',
        },
      },
      {
        label: 'Pay the Irrah guide',
        outcome: {
          rationsDelta: -1,
          risk: 'none',
          narrative:
            'The Irrah guide swims the rope across for a fee in salt. You cross dry, a sack lighter in trade-goods and a story richer.',
        },
      },
    ],
    [
      {
        label: 'Drive the camels across',
        outcome: {
          rationsDelta: -2,
          risk: 'minor',
          narrative:
            'You send the rahab down the bank in a line, salt-slabs high on their humps. The brown water takes them to the belly and one slab works loose of its palm-rope and is gone. The party crosses, a slab of trade-salt poorer.',
        },
      },
      {
        label: 'Camp above the water and wait',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            'You pitch above the flood-line and let the foggara run itself empty. The water drops on the second morning and the ford reads true. Two days of it you will not get back.',
        },
      },
      {
        label: "Buy the foggara-keeper's line",
        outcome: {
          rationsDelta: -1,
          risk: 'none',
          narrative:
            'The foggara-keeper runs a guide-rope for a fee in rock-salt and reads the current for you besides. You cross dry, a measure of salt lighter, and keep the day.',
        },
      },
    ],
  ],
  bandits: [
    [
      {
        label: 'Pay the toll',
        outcome: {
          rationsDelta: -3,
          risk: 'none',
          narrative:
            'You hand over the strongbox by the count of three. The masked riders melt back into the scrub. The party eats thin for it.',
        },
      },
      {
        label: 'Stand and fight',
        outcome: {
          rationsDelta: -1,
          waterDelta: -2,
          risk: 'grave',
          narrative:
            'Steel answers steel in the scrub. The riders break and run. Two of yours do not rise, and the wounded drink double.',
        },
      },
      {
        label: 'Parley',
        outcome: {
          rationsDelta: -1,
          daysDelta: 1,
          risk: 'minor',
          narrative:
            'You talk. The bandit-chief knows your manifest and your patience both. A day of words buys passage for a tithe of meal.',
        },
      },
    ],
    [
      {
        label: 'Buy off the riders',
        outcome: {
          rationsDelta: -3,
          risk: 'none',
          narrative:
            'A second band works the same scrub-line, bolder for the last toll paid. You empty a third of the strongbox into their hands and they wave the caravan on without a word wasted.',
        },
      },
      {
        label: 'Hold the line',
        outcome: {
          rationsDelta: -1,
          waterDelta: -2,
          risk: 'grave',
          narrative:
            'This crew rides in tighter and means it. Steel meets steel again in the scrub and this time the wounded are yours to carry. Two more do not answer at the count and the water goes to the ones who can still walk.',
        },
      },
      {
        label: 'Talk terms',
        outcome: {
          rationsDelta: -1,
          daysDelta: 1,
          risk: 'minor',
          narrative:
            'You have talked to bandit-chiefs before and it shows. This one wants less blood and more time. A day of bargaining under a scrub tree buys the caravan through for a lighter tithe.',
        },
      },
    ],
  ],
  fever: [
    [
      {
        label: 'Pay the healer',
        outcome: {
          rationsDelta: -2,
          risk: 'none',
          narrative:
            'The Tavakh Qarat healer takes payment in letters of credit and bitter root. The shivering eases by dusk. The strongbox is lighter.',
        },
      },
      {
        label: 'Press on',
        outcome: {
          waterDelta: -3,
          risk: 'grave',
          narrative:
            'You march the sick in the cart and hope. The fever rides with you. The water-skins empty faster than the road shortens.',
        },
      },
      {
        label: 'Rest the sick',
        outcome: {
          daysDelta: 2,
          risk: 'minor',
          narrative:
            'You halt and let the fever break in its own time. Two days are lost to the cots. The party rises gaunt but whole.',
        },
      },
    ],
    [
      {
        label: 'Pay the Hakim',
        outcome: {
          rationsDelta: -2,
          risk: 'none',
          narrative:
            'The Hakim reads the matula against the light and names it dune-fever. Cupping and a dose of hanzal cost two measures of the stores. The shivering breaks before the next watch.',
        },
      },
      {
        label: 'Push through',
        outcome: {
          waterDelta: -3,
          risk: 'grave',
          narrative:
            'You lash the sick to the cart and keep the column moving. The fever calls for water the road will not spare, and the skins run thin faster than the miles fall away.',
        },
      },
      {
        label: 'Halt for the sick',
        outcome: {
          daysDelta: 2,
          risk: 'minor',
          narrative:
            'You make camp and let the sun-debt burn itself out under blankets, not under a moving cart. Two days go to the cots. The party rises thin but every one of them rises.',
        },
      },
    ],
  ],
  'dry-wadi': [
    [
      {
        label: 'Trust her, take the wadi',
        outcome: {
          scarWater: 2,
          risk: 'minor',
          narrative:
            'You follow the Qalībin path-finder down into the dry wadi. She reads the salt-cracks like a ledger and the floor runs true between the hills. It spares two days. On the descent a cask cracks against the rock and bleeds out into the salt before anyone can right it, and the party draws less at every well from here on.',
        },
      },
      {
        label: 'Stay on the mapped trail',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            'You thank the path-finder and keep to the road you know. The mapped trail holds water at every marked well. It also holds every mile the wadi would have spared you.',
        },
      },
    ],
    [
      {
        label: "Follow the Azmarāʔ down",
        outcome: {
          scarWater: 2,
          risk: 'minor',
          narrative:
            'A different Azmarāʔ finds you a second wadi, drier and steeper than the first. She reads the salt-cracks without slowing and the floor holds. A cask slips its lashing on the last drop and cracks on the stone, and the party draws thinner at every well from here.',
        },
      },
      {
        label: 'Keep to the known road',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            "You thank her for the offer and keep to the road already walked. Every marked well on it still holds water. It also holds every mile the shortcut would have spared.",
        },
      },
    ],
  ],
  'customs-raid': [
    [
      {
        label: 'Pay the audit fee',
        outcome: {
          rationsDelta: -3,
          risk: 'none',
          narrative:
            'You pay the audit before it becomes a trial. Coin and letters of credit both, counted out on a Basin officer\'s folding table. The manifest comes back stamped and a third lighter.',
        },
      },
      {
        label: 'Give up the scribe',
        outcome: {
          risk: 'none',
          narrative:
            'You let them take the senior scribe back to the Tavakh Qarat under guard. The caravan rolls on at dawn, one ledger-hand short and quieter for it. He knew the manifest better than any of you.',
        },
      },
      {
        label: 'Refuse, force the issue',
        outcome: {
          daysDelta: 2,
          waterDelta: -1,
          risk: 'grave',
          narrative:
            'You refuse, and the standoff holds the road two days. The Basin officers send for a magistrate; the magistrate sends for his lunch. The seals break in the end, and you are poorer in days and patience both.',
        },
      },
    ],
    [
      {
        label: 'Settle the seal-fee',
        outcome: {
          rationsDelta: -3,
          risk: 'none',
          narrative:
            "A second Triple-Seal officer wants his own audit before the first one's ink is dry. You pay again in khatti and salt-weight both, and the manifest comes back stamped a third lighter still.",
        },
      },
      {
        label: 'Surrender a ledger-hand',
        outcome: {
          risk: 'none',
          narrative:
            'You give up the junior scribe this time, the one who keeps the water-count. He goes back to Tavakh-Qarat under guard and the caravan rolls on, one count short and no one quite sure who is keeping it now.',
        },
      },
      {
        label: 'Stand on the manifest',
        outcome: {
          daysDelta: 2,
          waterDelta: -1,
          risk: 'grave',
          narrative:
            'You refuse the seal a second time and the officers dig in for a magistrate again. Two days the standoff holds the road, and the casks pay for every hour of it before the seals finally break.',
        },
      },
    ],
  ],
  'plague-quarantine': [
    [
      {
        label: 'Hold at the cordon',
        outcome: {
          daysDelta: 12,
          risk: 'none',
          narrative:
            'You pitch camp below the red banner and wait the cordon out. The Irrah outrider counts the days on a knotted cord and will not be hurried. The fortnight passes. So do the stores.',
        },
      },
      {
        label: 'Buy a forged seal',
        outcome: {
          rationsDelta: -4,
          risk: 'grave',
          narrative:
            'A Khazadari scribe sells you a seal of clean passage, the ink still wet. The outrider studies it a long moment, then waves you through. You ride hard until the cordon is a rumour behind you.',
        },
      },
      {
        label: 'Take the salt-track around',
        outcome: {
          daysDelta: 3,
          waterDelta: -2,
          risk: 'minor',
          narrative:
            'You leave the road for the old salt-track the Irrah drovers use. It costs three days and the flats give up no water. But no banner flies out here, and no one counts your dead.',
        },
      },
    ],
    [
      {
        label: 'Wait out the second cordon',
        outcome: {
          daysDelta: 12,
          risk: 'none',
          narrative:
            "A second banner flies a day past the first, the sickness having outrun the outrider's count. You make camp again and wait the fortnight through. The stores do not care that this is the second wait.",
        },
      },
      {
        label: 'Pay for another seal',
        outcome: {
          rationsDelta: -4,
          risk: 'grave',
          narrative:
            'A Khazadari clerk downroad sells a seal cheaper than the last, and worse made. The outrider here squints at it a long moment before waving the caravan through, and you do not look back to see if he changes his mind.',
        },
      },
      {
        label: 'Cut back onto the salt-track',
        outcome: {
          daysDelta: 3,
          waterDelta: -2,
          risk: 'minor',
          narrative:
            "You leave the road a second time for the azalai's old salt-track. It costs three more days and the flats give up no water, same as before. No banner flies out here either.",
        },
      },
    ],
  ],
  'sabkha-sinkhole': [
    [
      {
        label: 'Cut the cart loose',
        outcome: {
          rationsDelta: -2,
          scarRations: 1,
          risk: 'none',
          narrative:
            'You cut the traces and let the salt take the cart whole. The stores in it are gone, swallowed with the axles. The party walks lighter and hungrier from here.',
        },
      },
      {
        label: 'Haul it out by rope',
        outcome: {
          daysDelta: 2,
          waterDelta: -4,
          risk: 'grave',
          narrative:
            'You rig ropes to the cart and the whole party hauls against the salt. Two days it fights you before it comes free, sucking and reluctant. The water-skins paid for every hour of it.',
        },
      },
    ],
    [
      {
        label: 'Let the second cart go',
        outcome: {
          rationsDelta: -2,
          scarRations: 1,
          risk: 'none',
          narrative:
            'The salt gives way under a second cart before the party has learned to read the crust. You cut the traces again and watch the stores go under with the axles. The party carries less, and hungrier, from here.',
        },
      },
      {
        label: 'Rope it out again',
        outcome: {
          daysDelta: 2,
          waterDelta: -4,
          risk: 'grave',
          narrative:
            'You rig the ropes a second time and the whole party hauls against the sabkha crust once more. It fights harder for having already had one cart. Two days and every water-skin pay for pulling the wheels free.',
        },
      },
    ],
  ],
  switchback: [
    [
      {
        label: 'Stave the water-casks',
        outcome: {
          scarWater: 2,
          risk: 'none',
          narrative:
            'You stave in the big water-casks and roll them off the switchback\'s edge; the carts take the grade light and the party crests by dusk. The water they held is gone into the rock, and from here every leg runs on a thinner skin.',
        },
      },
      {
        label: 'Double-team the climb',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            'You split the party and take the carts up one at a time, half hauling on the ropes while half set the chocks. Two days the escarpment costs you, loop by loop. No one falls and nothing is left behind. The party crests whole, and slower.',
        },
      },
    ],
    [
      {
        label: 'Empty the casks again',
        outcome: {
          scarWater: 2,
          risk: 'none',
          narrative:
            'A second grade climbs sharper than the first past the Lam-Chen loops. You stave the casks again and roll them off the edge; the carts crest light. The water they held does not come back at the next well the way rations do.',
        },
      },
      {
        label: 'Haul the carts up in turns',
        outcome: {
          daysDelta: 2,
          risk: 'none',
          narrative:
            'You split the party again, half on the ropes and half at the chocks, and take the carts up one loop at a time. Two more days the switchback costs. Nothing is lost this time either, only the hours.',
        },
      },
    ],
  ],
  'sand-wraith': [
    [
      {
        label: 'Drive straight through',
        outcome: {
          rationsDelta: -2,
          waterDelta: -1,
          risk: 'grave',
          narrative:
            'You crack the whip and run the dune face. The wraith keeps pace without breathing, and by dusk two pack animals have collapsed and a waterskin has burst under the heat.',
        },
      },
      {
        label: 'Circle wide through the salt-flat',
        outcome: {
          daysDelta: 1,
          waterDelta: -1,
          risk: 'minor',
          narrative:
            'You swing south onto the cracked salt, giving the crest a wide berth. The shape does not follow, but the flat costs a day and the glare drinks deep from the casks.',
        },
      },
      {
        label: 'Hold ranks, offer salt',
        outcome: {
          rationsDelta: -1,
          risk: 'none',
          narrative:
            'You halt and heap salt-cubes on a flat stone. The wraith rides the crest once, twice, then dissolves into the shimmer. The Irrah drovers were not wrong about the old courtesy.',
        },
      },
    ],
    [
      {
        label: 'Run the horses until dusk',
        outcome: {
          rationsDelta: -3,
          waterDelta: -2,
          risk: 'grave',
          narrative:
            'The second wraith is faster. You flog the horses across the hardpan and do not look back. Two animals founder before sunset, and the survivors drink their share.',
        },
      },
      {
        label: 'Form a salt-circle and wait',
        outcome: {
          daysDelta: 1,
          risk: 'none',
          narrative:
            'You trace a ring of salt around the camp and let the wraith circle until dawn. It does not cross the line. The night was costly in sleep, but the party is whole.',
        },
      },
      {
        label: 'Send the Irrah outrider to bargain',
        outcome: {
          rationsDelta: -1,
          waterDelta: -1,
          risk: 'minor',
          narrative:
            'The Irrah outrider walks out alone with salt-cubes in her open hands. She returns at noon empty-handed and white-faced, but the crest is clear and the road is open.',
        },
      },
    ],
  ],
}

/* ─── Endings ─── */

export type PassageOutcome = 'in-progress' | 'arrived' | 'aborted' | 'perished'

/** Debt floors that trigger a `perished` (forced-back) ending. Supply is allowed
 *  to run negative as "debt" first (the ledger shows it); crossing these ends the
 *  crossing. Water is the more lethal of the two, so its floor is shallower.
 *  Tunable — revisit against playtest feel. */
export const PERISH_WATER_FLOOR = -3
export const PERISH_RATIONS_FLOOR = -6

/* ─── Journal ─── */

export type PassageEntry =
  /** A travelled day produced by the engine. */
  | { kind: 'day'; dayLabel: number; day: JourneyDay; supply: SupplyDay }
  /** A synthetic wait/detour day (from a choice's daysDelta). */
  | { kind: 'wait'; dayLabel: number; supply: SupplyDay; narrative: string }
  /** The chosen branch of a signature encounter (one-off deltas folded in). */
  | { kind: 'choice'; dayLabel: number; label: string; narrative: string; risk: 'none' | 'minor' | 'grave' }
  /** A mid-passage reroute to a new destination (no day consumed; route swapped). */
  | { kind: 'reroute'; dayLabel: number; toName: string; narrative: string }
  /** The closing entry. */
  | { kind: 'ending'; dayLabel: number; outcome: Exclude<PassageOutcome, 'in-progress'>; narrative: string }

export interface PendingEncounter {
  encounter: Encounter
  choices: EncounterChoice[]
}

export interface PassageState {
  journey: JourneyState
  /** Append-only journal of everything that has happened. */
  log: PassageEntry[]
  /** Synthetic wait days accumulated from choices. Player-facing day = journey.dayNum + extraDays. */
  extraDays: number
  /** A signature encounter awaiting the player's choice; null when free to advance. */
  pending: PendingEncounter | null
  outcome: PassageOutcome
  /**
   * Number of times each signature encounter key has already been resolved in this
   * journey. Used to pick the next prose variant from SIGNATURE_CHOICES. Kept as a
   * plain object so PassageState stays JSON-serializable.
   */
  signatureCounts: Record<string, number>
}

/* ─── Helpers ─── */

/** Player-facing day count: engine days travelled plus synthetic wait days. */
function currentDay(state: PassageState): number {
  return state.journey.dayNum + state.extraDays
}

/**
 * Index of the route node the party has most recently reached, for the
 * current-position map marker. Snaps to the nearer endpoint of the leg in
 * progress (mirrors the engine's camp-label snap). Lives here, not in the UI,
 * so the marker only reads a number and never reimplements the day→position
 * walk. v1 has no reroute, so dayOffset is always 0.
 */
export function currentNodeIndex(state: PassageState): number {
  const { route, dayNum, dayOffset } = state.journey
  const localDay = dayNum - dayOffset
  if (localDay <= 0) return 0
  let acc = 0
  for (let i = 0; i < route.edges.length; i++) {
    const ed = route.edges[i].segmentDays || 0
    if (acc + ed >= localDay) {
      const frac = ed > 0 ? (localDay - acc) / ed : 1
      return frac >= 0.5 ? i + 1 : i
    }
    acc += ed
  }
  return route.nodes.length - 1
}

/** The first signature encounter bucketed on engine day `d`, if any. */
function signatureForDay(
  journey: JourneyState,
  d: number,
  signatureCounts: Record<string, number>,
): PendingEncounter | null {
  const encs = journey.encountersByDay.get(d)
  if (!encs) return null
  for (const enc of encs) {
    if (!enc.key) continue
    const variants = SIGNATURE_CHOICES[enc.key]
    if (!variants) continue
    const instance = signatureCounts[enc.key] ?? 0
    const idx = instance % variants.length
    return { encounter: enc, choices: variants[idx] }
  }
  return null
}

/** Closing prose per ending. Em-dash-free. */
function endingNarrative(outcome: Exclude<PassageOutcome, 'in-progress'>, journey: JourneyState): string {
  const dest = journey.route.nodes[journey.route.nodes.length - 1]?.name ?? 'the far gate'
  switch (outcome) {
    case 'arrived':
      return `The road ends. You come down into ${dest} with the dust of the whole crossing on you, and the gate-keeper does not ask your business twice.`
    case 'aborted':
      return 'You turn the column around. The road you came by is longer going back, and it knows your faces now. Better that than the road ahead.'
    case 'perished':
      return 'The stores are spent past the last honest count. There is no forward left in the party. What can still walk turns back toward the last good water, and hopes.'
  }
}

/**
 * Decide the outcome after an advance and append the closing entry if terminal.
 * `arrived`/`aborted` come from the engine; `perished` is the debt-floor check.
 * Mutates `state` (caller owns a fresh state already). Returns the same state.
 */
function settleOutcome(state: PassageState): PassageState {
  if (state.outcome !== 'in-progress') return state
  let outcome: PassageOutcome = 'in-progress'
  if (state.journey.outcome === 'arrived') outcome = 'arrived'
  else if (state.journey.outcome === 'aborted') outcome = 'aborted'
  else if (
    state.journey.waterLeft <= PERISH_WATER_FLOOR ||
    state.journey.rationsLeft <= PERISH_RATIONS_FLOOR
  ) {
    outcome = 'perished'
  }
  if (outcome !== 'in-progress') {
    state.outcome = outcome
    state.log.push({
      kind: 'ending',
      dayLabel: currentDay(state),
      outcome,
      narrative: endingNarrative(outcome, state.journey),
    })
  }
  return state
}

/* ─── Public API ─── */

/**
 * Zero the engine-side supplyCost of every signature encounter in a journey's
 * buckets, so the player's CHOICE owns 100% of that encounter's supply movement
 * (the engine otherwise bakes encounter supplyCost into the day's burn, which
 * would stack invisibly on the choice delta). Mutates in place; the encounter
 * objects belong to this just-built JourneyState. Exported for unit testing.
 */
export function zeroSignatureCosts(journey: JourneyState): void {
  for (const encs of journey.encountersByDay.values()) {
    for (const enc of encs) {
      if (enc.key && SIGNATURE_CHOICES[enc.key]) {
        enc.supplyCost = { rations: 0, water: 0 }
      }
    }
  }
}

/**
 * Begin a passage from the same inputs Atlas computed. Seeds a JourneyState via
 * the existing engine, then zeroes the engine-side supplyCost of every signature
 * encounter so the player's choice owns its supply movement.
 *
 * Resupply is activated by default: if the caller does not supply its own
 * `resupplyTierFor`, the canonical `getResupplyTier` mapping is used so reaching
 * a town/caravanserai (full) or port/oasis (water) restocks. This brings live
 * Passage into line with the sim-tuned 6/6 supply economy (the sim always ran
 * with resupply on) and is what makes the capacity-scar ceiling actually bite.
 * Pass `resupplyTierFor: () => 'none'` to opt out.
 */
export function initPassage(opts: JourneyStateOpts): PassageState {
  const journey = initJourneyState({ ...opts, resupplyTierFor: opts.resupplyTierFor ?? getResupplyTier })
  zeroSignatureCosts(journey)
  return { journey, log: [], extraDays: 0, pending: null, outcome: 'in-progress', signatureCounts: {} }
}

/**
 * Advance the passage by one player action. A `continue` that would land on a
 * signature encounter sets `pending` instead of advancing (the player must
 * resolve it via `passageChoose`). All other actions step the engine directly.
 * No-op once finished or while a choice is pending.
 */
export function passageAct(state: PassageState, action: Action): PassageState {
  if (state.outcome !== 'in-progress' || state.pending) return state

  if (action.kind === 'continue') {
    const sig = signatureForDay(state.journey, state.journey.dayNum + 1, state.signatureCounts)
    if (sig) {
      return { ...state, pending: sig }
    }
  }

  const result = nextDay(state.journey, action)
  if (!result.advanced) return state

  const next: PassageState = {
    ...state,
    journey: result.state,
    log: [...state.log],
  }
  if (result.day && result.supply) {
    next.log.push({
      kind: 'day',
      dayLabel: result.state.dayNum + next.extraDays,
      day: result.day,
      supply: result.supply,
    })
  }
  return settleOutcome(next)
}

/**
 * Resolve a pending signature encounter by choice index. Applies the choice's
 * synthetic wait days (each a real burn via the engine's `applyDailyBurn`), then
 * the one-off supply delta, then advances the encounter day via the engine.
 */
export function passageChoose(state: PassageState, choiceIndex: number): PassageState {
  if (!state.pending || state.outcome !== 'in-progress') return state
  const choice = state.pending.choices[choiceIndex]
  if (!choice) return state

  // Work on a mutable clone of the journey's mutable supply fields.
  let journey: JourneyState = { ...state.journey }
  const log: PassageEntry[] = [...state.log]
  let extraDays = state.extraDays

  // 1. Synthetic wait days — each a stationary rest-rate burn (no rations, full water),
  //    computed by the engine's pure burn so the formula stays single-homed.
  const waitDays = choice.outcome.daysDelta ?? 0
  for (let i = 0; i < waitDays; i++) {
    const burn = applyDailyBurn(
      journey.rationsLeft,
      journey.waterLeft,
      journey.supplyConstants,
      journey.party,
      journey.season,
      'none',
      'none',
      { rations: 0, water: 1 },
      { rations: 0, water: 0 },
      journey.mode,
    )
    journey = { ...journey, rationsLeft: burn.rationsLeft, waterLeft: burn.waterLeft }
    extraDays += 1
    log.push({
      kind: 'wait',
      dayLabel: journey.dayNum + extraDays,
      supply: {
        dayNum: journey.dayNum + extraDays,
        rationsLeft: burn.rationsLeft,
        waterLeft: burn.waterLeft,
        rationsBurnedToday: burn.rationsBurnedToday,
        waterBurnedToday: burn.waterBurnedToday,
        warning: burn.warning,
      },
      narrative: 'A day held against the road. The stores draw down and the road does not.',
    })
  }

  // 2. One-off supply movement + any permanent scar from the choice. The scar lowers
  //    the resupply ceiling; current stores are clamped DOWN to that new ceiling (you
  //    cannot carry above your reduced max), which also keeps later resupply a refill-up.
  const newScarRations = (journey.scarRations ?? 0) + (choice.outcome.scarRations ?? 0)
  const newScarWater = (journey.scarWater ?? 0) + (choice.outcome.scarWater ?? 0)
  const ceilRations = Math.max(0, journey.supplyConstants.startingRations - newScarRations)
  const ceilWater = Math.max(0, journey.supplyConstants.startingWater - newScarWater)
  journey = {
    ...journey,
    scarRations: newScarRations,
    scarWater: newScarWater,
    rationsLeft: Math.min(journey.rationsLeft + (choice.outcome.rationsDelta ?? 0), ceilRations),
    waterLeft: Math.min(journey.waterLeft + (choice.outcome.waterDelta ?? 0), ceilWater),
  }

  // 3. Record the chosen branch.
  log.push({
    kind: 'choice',
    dayLabel: journey.dayNum + extraDays,
    label: choice.label,
    narrative: choice.outcome.narrative,
    risk: choice.outcome.risk ?? 'none',
  })

  // 4. Resolve the encounter day itself via the engine (signature cost already zeroed).
  const result = nextDay(journey, { kind: 'continue' })
  const key = state.pending.encounter.key
  const nextCounts = key
    ? { ...state.signatureCounts, [key]: (state.signatureCounts[key] ?? 0) + 1 }
    : state.signatureCounts

  let next: PassageState = {
    journey: result.advanced ? result.state : journey,
    log,
    extraDays,
    pending: null,
    outcome: 'in-progress',
    signatureCounts: nextCounts,
  }
  if (result.advanced && result.day && result.supply) {
    next.log.push({
      kind: 'day',
      dayLabel: result.state.dayNum + extraDays,
      day: result.day,
      supply: result.supply,
    })
  }

  // Perish can be triggered by the wait/choice burn even before the day resolves.
  return settleOutcome(next)
}

/**
 * Turn the column toward a new destination mid-passage. Delegates to the engine's
 * `reroute` action, which snaps the party to the nearer route node, recomputes the
 * path from there to `newEndId`, and rebuckets it with `dayOffset = dayNum` so the
 * day counter continues unbroken. Supply, scars, and exhaustion carry forward; no
 * day is consumed (reroute is the decision, not a day's travel).
 *
 * No-op once finished, while a choice is pending, or if the passage was started
 * without the graph/destination wiring the engine reroute requires.
 */
export function passageReroute(state: PassageState, newEndId: string, mode: RouteMode): PassageState {
  if (state.outcome !== 'in-progress' || state.pending) return state
  if (!state.journey.graph || !newEndId) return state

  const journey: JourneyState = { ...state.journey, endId: newEndId }
  const result = nextDay(journey, { kind: 'reroute', mode })
  if (!result.advanced) return state

  zeroSignatureCosts(result.state)
  const dest = result.state.route.nodes[result.state.route.nodes.length - 1]?.name ?? 'a new heading'
  const next: PassageState = {
    ...state,
    journey: result.state,
    log: [
      ...state.log,
      {
        kind: 'reroute',
        dayLabel: currentDay(state),
        toName: dest,
        narrative: `You turn the column off the planned road. The new heading is ${dest}, and the party reckons its stores against the road still to come.`,
      },
    ],
  }
  return settleOutcome(next)
}
