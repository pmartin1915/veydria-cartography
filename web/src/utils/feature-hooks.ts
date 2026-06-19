/**
 * feature-hooks.ts — Deterministic adventure-hook generator per feature
 *
 * Given any map feature, produces 3 seeded-random adventure hooks tailored to
 * its category, name, and available properties. Same feature → same hooks,
 * so GMs can revisit a location and get consistent inspiration.
 *
 * Hooks are lore seeds, not finished prose. The GM dresses them.
 *
 * Storage: localStorage `veydria.hooks.v1` — Record<featureId, string[]>
 */

import { kvStore } from '../persistence/kv-store'
import { djb2Hash, mulberry32 } from './encounters'

export interface FeatureHook {
  text: string
  tags: string[]
}

/* ─── Seeded RNG helpers ─── */

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function seededPick<T>(arr: T[], seed: number): T {
  const rng = mulberry32(seed)
  return arr[Math.floor(rng() * arr.length)]
}

/* ─── Template pools by category ─── */

const PORT_HOOKS: string[] = [
  'A {name} customs inspector has been taking bribes in Khazadari steel instead of coin — the Tavakh Qarat want her head, but the smugglers want her alive.',
  'An Oravan wave-tithe collector claims a vessel is under-counted; the captain produces a letter of marque signed by a khatt who died three years ago.',
  'A Ndajdi rice-barge captain offers passage south in exchange for a Qalībin path-finder who can read the mangrove channels.',
  'Refugees from the Kheshkai highlands have blockaded the {name} quay, demanding passage to the Basin before the three-year skyward.',
  'A Ngaru-Bon slate-merchant is selling "river-certified" stone that crumbles in salt water; the Basin Authority has posted a quiet bounty.',
  'The {name} harbourmaster\'s logbook shows three ships that never existed — or that existed, docked, and vanished with all hands.',
  'A Qollari mushroom-trader wants to charter a ship but will not name the destination; she pays in dried cloud-forest spores worth ten times her cargo.',
  'An Irrah salt-courier arrives with a sealed strongbox for the Tavakh Qarat. The seal is intact, but the weight is wrong — it rattles like bone, not salt.',
  'The {name} dry-dock crews have gone on strike; every hull in harbour is rotting, and the monsoon is two weeks away.',
  'A Khazadari astrolabe-maker is recruiting a crew to sail beyond the Halkar Straits to verify a star-chart that puts a new island where no island should be.',
]

const CHOKEPOINT_HOOKS: string[] = [
  'The {name} toll-keepers have raised rates overnight; caravans are turning back, and the Copper for Steel Road is backing up to the escarpment.',
  'Bandit-sign freshly scratched on the {name} watch-tower: three circles, meaning "armed escort, heavy cargo, willing to negotiate".',
  'A Khazadari patrol found a dead messenger at {name} with a letter of credit for ten thousand khatti — unsigned, unclaimed, and very wanted.',
  'The {name} ferry has sunk; the rope is cut clean, not frayed. The ferryman\'s family blames the Ngaru-Bon slate guild.',
  'Spring floods have shifted the {name} ford fifty paces downstream; the old crossing is now a whirlpool, and the new one is disputed territory.',
  'A Qalībin salt-cube convoy is refusing to pay the {name} toll in anything but Irrah credit — the pass guards are armed and hungry.',
  'Someone has been moving the cairn-marks at {name}; three caravans have vanished in the mist this month alone.',
  'The {name} outpost commander has locked the gates; he claims plague, but the refugees say he\'s hiding a Ndajdi tax-collector\'s ransom.',
  'An Oravan beacon-keeper at {name} reports the light burns blue at midnight — a signal that hasn\'t been used since the last Harbor Oath War.',
  'Kheshkai steppe-riders have begun using {name} as a winter corral; the Highland-Steppe Corridor is impassable until they move on.',
]

const OASIS_HOOKS: string[] = [
  'The {name} well has run shallow three years early; the headman is selling water-rights he does not own, and the Irrah well-keepers are coming to collect.',
  'A sand-buried vault has opened near {name} after a flash flood; the first explorer brought out a copper seal stamped with a dead civilization\'s mark.',
  'Nomads at {name} speak of a "walking well" — a spring that shifts with the dunes, never in the same place twice. They will guide you to it for a daughter\'s bride-price.',
  'The {name} date-palm grove is dying from the roots up; a Qollari spore-hunter claims she can cure it, but her remedy requires a living crocodile heart.',
  'A Khazadari caravan arrived at {name} with every member blind from sun-sickness; they carry a map to a salt-mine no living trader has seen.',
  'The {name} night-guard has been found sleepwalking into the dunes at midnight, speaking a language no one recognises, then waking with no memory.',
]

const CONTESTED_SITE_HOOKS: string[] = [
  'Both Ngaru-Bon and Khazadari surveyors have planted boundary stones at {name}; the stones overlap by exactly one arm\'s length, and both nations have sent troops.',
  'An archaeological team at {name} has uncovered a pre-Basin script; every translator who reads it falls into a fever that lasts three days and leaves them weeping.',
  'The {name} garrison commander has begun taxing pilgrims; the religious orders have pooled funds for a "quiet removal".',
  'A Ndajdi charcoal-burner claims {name} is built on his grandfather\'s fishing-grounds; he has the deeds, written on bark, in a language the court scribe cannot read.',
  'Oravan wave-witches have declared {name} sacred ground after a storm deposited a ship\'s figurehead there — carved from stone that does not exist on any charted island.',
  'The Metal Interdict patrols have surrounded {name}; they are searching for smuggled steel, but the locals whisper they are looking for something older.',
]

const CIVILIZATION_HOOKS: string[] = [
  'The {name} khatt has not been seen in public for forty days; the court claims illness, but the market says succession.',
  'A new trade guild in {name} is offering letters of credit backed by "future harvests" — the Basin Authority suspects fraud, but the rates are irresistible.',
  'The {name} three-year skyward festival has begun early this cycle; the priests will not say why, and the astronomers are arguing in public.',
  'A Kheshkai wrestler has defeated every champion in {name} without speaking; the betting houses have shut down, and the old champions want answers.',
  'An Irrah salt-matriarch has arrived in {name} with twenty camel-loads of white salt and a demand for an audience — she claims the Basin owes her family a debt from before the Oath.',
  'The {name} irrigation council has voted to divert the western channel; downstream farmers have armed themselves with threshing-flails and old grudges.',
  'A Qollari envoy in {name} offers mushroom-wine that lets the drinker see the future; the first three tasters are dead, the fourth is in hiding, and the fifth is buying.',
  'The {name} harbormaster\'s daughter has eloped with an Oravan fisher-captain; both families have put prices on the captain\'s ship, and neither has mentioned the daughter.',
  'Ndajdi rice-prices in {name} have tripled since the monsoon failed; the poor are eating mud-grubs, and the rich are stockpiling grain in sealed caves.',
  'A Ngaru-Bon slate-sculptor in {name} has carved a relief that predicts the date of the next Harbor Oath War; the relief is on public display, and no one dares destroy it.',
]

const TRADE_ROUTE_HOOKS: string[] = [
  'A copper merchant on the {name} offers passage in exchange for a letter of introduction to a Khazadari khatt — the letter must be written in blood.',
  'The {name} is blocked by a broken axle on a southbound steel cart; the smith\'s apprentice weeps openly, and the cart\'s guards will not let anyone approach.',
  'Qalībin path-finders argue the {name} mapped trail is wrong — one knows a dry wadi that cuts two days, but demands a blood-oath of silence.',
  'A Ndajdi forester demands a "green toll" on the {name} — payment in seed or labour, not metal, and not negotiable.',
  'Ngaru-Bon slate-porters refuse to share the {name}; their loads are fragile, their tempers shorter, and their escort carries a writ from the Tavakh Qarat.',
  'Caravan of Kheshkai wool-merchants overtakes you on the {name} at dawn; their pace reveals a hidden watering hole, and their silence reveals they do not want company.',
  'The {name} bottleneck is guarded by a new militia wearing no colours; they take tolls in information, not coin, and write everything in a cipher no one recognises.',
  'An Oravan wave-tithe collector boards the coastal leg of the {name}; she demands duty or a convincing story, and her definition of "convincing" changes with the tide.',
  'Spring floods have washed out the {name} ford; an Irrah guide offers to swim the rope across for a salt-cube fee that doubles every hour.',
  'A plague-quarantine banner blocks the {name}; no party crosses without a fortnight\'s wait, or a forged seal of clean passage from the Tavakh Qarat.',
]

const WATER_HOOKS: string[] = [
  'A Ndajdi fishing fleet has staked claim to the {name} northern reach; the Kheshkai highland villages downstream say the fish have already stopped running.',
  'The {name} current has reversed direction for three days; the Khazadari astronomers have no explanation, and the priests have too many.',
  'An Oravan diver in the {name} surfaced with a handful of coins from a civilization that never touched these waters; she will not say where she found them.',
  'The {name} is glowing pale green after dark; the Tavakh Qarat have posted a reward for a water-sample, but every sample taken by daylight is perfectly normal.',
  'A floating market has anchored in the {name} shallows — no flags, no registrations, and prices in currencies that have not been minted in a century.',
  'The {name} opening has silted half-closed; Basin traffic is backing up, and the dredging crews have uncovered something that makes them refuse to work.',
]

const LANDMARK_HOOKS: string[] = [
  'Pilgrims at {name} have begun leaving offerings of iron; the old tradition was copper, and the change has the Metal Interdict patrols asking questions.',
  'A Qollari mushroom-seer climbed {name} at midsummer and returned blind, claiming the mountain\'s shadow points to a city that does not exist on any map.',
  'The {name} echo has changed pitch; musicians who recorded the old note confirm the shift, but geologists say the stone has not moved.',
  'Kheshkai sky-burial platforms circle {name} at dawn; the bodies are recent, but the families deny any deaths, and the platforms are empty.',
  'An Irrah salt-caravan found a sealed door in the {name} foothills; the door is warm to the touch, and the symbols around it match no known script.',
  'Ngaru-Bon herders refuse to graze within sight of {name} this season; they say the grass tastes of copper, and their dogs will not stop howling at noon.',
  'The {name} summit ice has melted to reveal a ship\'s hull — not a lake-vessel, but a deep-ocean keel, perfectly preserved, with no plausible route to this altitude.',
  'A Ndajdi spirit-medium claims {name} is the anchor-point of a curse that reaches every port on the Basin; she will lift it for the price of a firstborn child, or equivalent.',
]

const RIVER_HOOKS: string[] = [
  'The {name} ferryman has raised his rates to double the khatti standard; he claims the rope is cursed, and the old rope is hanging in his shed, perfectly sound.',
  'Spring melt has swollen the {name} beyond its banks; a stranded village offers a generations-old irrigation deed to anyone who can rebuild the levee before the next crest.',
  'An Oravan fishing-net pulled up a sealed clay jar from the {name} bed; inside is a letter dated thirty years in the future, addressed to the current Tavakh Qarat harbormaster.',
  'The {name} has changed colour upstream — from brown to pale blue — and the fish that swim there now have teeth that can score copper.',
  'A Qalībin water-lawyer has filed claim that the {name} belongs to his grandfather\'s grandfather; the deed is written on papyrus, the ink is fresh, and the court is divided.',
  'Kheshkai herders have diverted the {name} tributary to water their flocks; downstream Ndajdi paddies are drying, and the irrigation council has hired muscle.',
  'The {name} crossing stones have shifted overnight; the old path is now knee-deep, and a new set of stones — smoother, darker, older — has appeared fifty paces upstream.',
]

/* ─── Category → pool map ─── */

const POOLS: Record<string, string[]> = {
  port: PORT_HOOKS,
  chokepoint: CHOKEPOINT_HOOKS,
  oasis: OASIS_HOOKS,
  contested_site: CONTESTED_SITE_HOOKS,
  civilization: CIVILIZATION_HOOKS,
  trade_route: TRADE_ROUTE_HOOKS,
  water: WATER_HOOKS,
  landmark: LANDMARK_HOOKS,
  river: RIVER_HOOKS,
}

/* ─── Public API ─── */

export interface HookGenOptions {
  /** Number of hooks to generate (default 3) */
  count?: number
  /** Optional RNG override for testing */
  rng?: () => number
}

/**
 * Generate adventure hooks for a feature.
 *
 * Deterministic: the same feature ID always produces the same set.
 * Uses a shuffled pool + slice so there are no repeats within a set.
 */
export function generateFeatureHooks(
  featureId: string,
  featureName: string,
  category: string,
  opts: HookGenOptions = {}
): FeatureHook[] {
  const count = Math.max(1, Math.min(5, opts.count ?? 3))
  const pool = POOLS[category] || POOLS.landmark
  if (pool.length === 0) return []

  const seed = djb2Hash(`${featureId}#${category}`)
  const shuffled = seededShuffle(pool, seed)

  const hooks: FeatureHook[] = []
  for (let i = 0; i < count; i++) {
    const template = shuffled[i % shuffled.length]
    hooks.push({
      text: template.replace(/\{name\}/g, featureName),
      tags: deriveTags(category, template),
    })
  }
  return hooks
}

function deriveTags(category: string, template: string): string[] {
  const tags: string[] = [category.replace('_', '-')]
  const lowered = template.toLowerCase()
  if (lowered.includes('trade') || lowered.includes('merchant') || lowered.includes('cargo')) tags.push('trade')
  if (lowered.includes('combat') || lowered.includes('bandit') || lowered.includes('militia') || lowered.includes('war')) tags.push('conflict')
  if (lowered.includes('plague') || lowered.includes('fever') || lowered.includes('curse') || lowered.includes('sick')) tags.push('disease')
  if (lowered.includes('ghost') || lowered.includes('spirit') || lowered.includes('haunt') || lowered.includes('supernatural')) tags.push('supernatural')
  if (lowered.includes('political') || lowered.includes('succession') || lowered.includes('court') || lowered.includes('guild')) tags.push('political')
  if (lowered.includes('religious') || lowered.includes('pilgrim') || lowered.includes('sacred') || lowered.includes('priest')) tags.push('religious')
  if (lowered.includes('treasure') || lowered.includes('vault') || lowered.includes('map') || lowered.includes('reward')) tags.push('treasure')
  return tags
}

/* ─── Persistence ─── */

const STORAGE_KEY = 'veydria.hooks.v1'

export function loadFeatureHooks(): Record<string, FeatureHook[]> {
  try {
    const raw = kvStore.getString(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, FeatureHook[]> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((h) => typeof h?.text === 'string' && Array.isArray(h?.tags))) {
        out[k] = v as FeatureHook[]
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveFeatureHooks(all: Record<string, FeatureHook[]>): void {
  try {
    kvStore.setString(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // storage full or private mode — silently drop
  }
}

export function getStoredHooks(featureId: string): FeatureHook[] | null {
  const all = loadFeatureHooks()
  return all[featureId] ?? null
}

export function storeHooks(featureId: string, hooks: FeatureHook[]): void {
  const all = loadFeatureHooks()
  all[featureId] = hooks
  saveFeatureHooks(all)
}

export function clearAllFeatureHooks(): void {
  try {
    kvStore.remove(STORAGE_KEY)
  } catch {
    // ignore
  }
}
