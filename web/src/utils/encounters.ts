/**
 * encounters.ts — Deterministic encounter generator for Journey Mode
 *
 * Given a route, season, and travel mode, produces a reproducible set of
 * encounter beats seeded by the route signature. Same route → same encounters.
 *
 * The beats are hand-authored lore seeds, not finished prose. The GM dresses them.
 */

import type { JourneyRoute, JourneyEdge, Season, RouteMode } from './journey-graph'
import { isSeaLeg } from './journey-graph'
import type { TimeOfDay } from './time-of-day'
import { augmentPoolWithWeighted, externalBeatsFor } from './external-encounters'

export interface Encounter {
  segmentIdx: number
  beat: string
  type: 'social' | 'environmental' | 'combat' | 'opportunity'
  severity: 'mild' | 'moderate' | 'severe'
  narrative: string
  /** If this encounter was drawn from a biome-specific beat, the biome name. */
  biome?: string
  /** Source encounter-canon key (e.g. `oravan.sperm_whale_deep_strait`) when drawn
   *  from worldbuilder's external pool; undefined for hand-authored beats. Lets the
   *  UI resolve an at-sea sighting back to its marginalia silhouette + canon name. */
  key?: string
  /** Supply cost debited end-of-day, before resupply restore. Pure function of severity (see severityCost). */
  supplyCost: { rations: number; water: number }
  /**
   * Time of day this encounter is set at. Assigned from a SEPARATE deterministic
   * seed (see assignTimeOfDay) so it never perturbs the beat-selection RNG stream
   * — severity/type/supplyCost are unchanged, keeping the sim baseline intact.
   * Weighted toward 'day'; prose-anchored beats (Beat.timeOfDay) pin their own time.
   */
  timeOfDay: TimeOfDay
}

/** Deterministic severity → supply cost table. Mild stays cosmetic (0/0);
 *  moderate burns one day-equivalent (1/1); severe burns two (2/2). */
export function severityCost(severity: Encounter['severity']): { rations: number; water: number } {
  if (severity === 'severe') return { rations: 2, water: 2 }
  if (severity === 'moderate') return { rations: 1, water: 1 }
  return { rations: 0, water: 0 }
}

/* ─── Seeded RNG ─── */

export function djb2Hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i)
  }
  return h >>> 0
}

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ─── Beat pools ─── */

export interface Beat {
  text: string
  type: Encounter['type']
  severity: Encounter['severity']
  seasons?: Season[]
  excludeSeasons?: Season[]
  /** If set, this beat only surfaces when the hex's dominant biome matches. */
  biome?: string
  /** Source encounter-canon key, propagated from the external pool (see Encounter.key). */
  key?: string
  /**
   * Times of day this beat is appropriate for. When set, the encounter's
   * time-of-day is chosen from this list (deterministically) instead of the
   * default weighted roll — used to pin prose that names a time ("at dawn",
   * "blue at dusk") so the displayed badge never contradicts the text.
   */
  timeOfDay?: TimeOfDay[]
}

export const TRADE_ROUTE_BEATS: Beat[] = [
  { text: 'Copper merchant from the Irrah salt-flats offers passage in exchange for a letter of introduction.', type: 'social', severity: 'mild' },
  { text: 'Khazadari money-changer sets up a folding table at the crossroads; rates favour khatti credit over coin.', type: 'social', severity: 'mild' },
  { text: 'Qalībin path-finder argues the mapped trail is wrong — knows a dry wadi that cuts two days if you trust her.', type: 'opportunity', severity: 'moderate', key: 'dry-wadi' },
  { text: 'Oravan wave-tithe collector boards the coastal leg; demands duty or a convincing story.', type: 'social', severity: 'moderate' },
  { text: 'Ndajdi foresters demand a "green toll" — payment in seed or labour, not metal.', type: 'social', severity: 'mild' },
  { text: 'Caravan of Kheshkai wool-merchants overtakes you at dawn; their pace reveals a hidden watering hole.', type: 'opportunity', severity: 'mild', timeOfDay: ['dawn'] },
  { text: 'Ngaru-Bon slate-porters refuse to share the trail; their loads are fragile and their tempers shorter.', type: 'social', severity: 'moderate' },
  { text: 'A broken axle on a southbound steel cart blocks the Copper for Steel Road; the smith\'s apprentice weeps openly.', type: 'environmental', severity: 'moderate' },
  { text: 'Spring floods have washed out the ford; an Irrah guide offers to swim the rope across for a salt-cube fee.', type: 'environmental', severity: 'moderate', seasons: ['spring'], key: 'ford' },
  { text: 'Summer heat warps the horizon; a mirage shows the Tavakh Qarat spires where no citadel has ever stood.', type: 'environmental', severity: 'mild', seasons: ['summer'] },
  { text: 'Autumn mud on the Basin track swallows cart-wheels whole; a Qalībin crew will winch you out for a favour owed.', type: 'environmental', severity: 'moderate', seasons: ['autumn'] },
  { text: 'Winter ice sheaths the mountain road; a Khazadari patrol passes in silence, their yak-hair boots making no sound.', type: 'environmental', severity: 'mild', seasons: ['winter'] },
  { text: 'Banditry: masked riders fan out from a Ngaru-Bon scrub-line and demand the strongbox by the count of three. They know your cargo manifest by name.', type: 'combat', severity: 'severe', key: 'bandits' },
  { text: 'A Basin customs raid surrounds the caravan at dawn — letters of credit are seized for "audit", and the senior scribe is meant to ride back to the Tavakh Qarat under guard.', type: 'social', severity: 'severe', timeOfDay: ['dawn'], key: 'customs-raid' },
  { text: 'Plague-quarantine: an Irrah salt-flats outrider blocks the road with a red banner. No party crosses without a fortnight\'s wait at the cordon, or a forged seal of clean passage.', type: 'environmental', severity: 'severe', key: 'plague-quarantine' },
  // Biome-specific trade-route beats
  { text: 'A sand-wraith rides the dune-crest at noon — heat-shimmer or spirit, the caravan master will not wait to find out.', type: 'environmental', severity: 'moderate', biome: 'Desert', timeOfDay: ['day'] },
  { text: 'The salt-crust crunches under wheel; a sabkha sinkhole opens, swallowing the rear cart whole.', type: 'environmental', severity: 'severe', biome: 'Sabkha', key: 'sabkha-sinkhole' },
  { text: 'Date-palm shade at the oasis well; a water-rights dispute between two Irrah clans boils over.', type: 'social', severity: 'moderate', biome: 'Oasis' },
  { text: 'Mangrove roots tangle the trail; crocodiles sun on mud-banks and the guide will not pole past them.', type: 'environmental', severity: 'moderate', biome: 'Mangrove swamp' },
  { text: 'The Ndajdi floodplain is a maze of seasonal channels; a stranded fisher-family waves from a mud island.', type: 'opportunity', severity: 'mild', biome: 'Floodplain' },
  { text: 'Qollari mist closes to arm\'s length; moss-draped trees hide a trail-marker and the path doubles back.', type: 'environmental', severity: 'mild', biome: 'Cloud forest' },
  { text: 'Grass fires on the horizon; Ngaru-Bon herders drive their flock across the trade road without apology.', type: 'environmental', severity: 'moderate', biome: 'Highland savanna' },
  { text: 'Kheshkai wind erosion has exposed a bone-bed; a Khazadari scholar pays silver for intact skulls.', type: 'opportunity', severity: 'mild', biome: 'Steppe' },
  { text: 'Oravan pumice dust coats every surface; the crew coughs blood and the captain consults a wind-witch.', type: 'environmental', severity: 'severe', biome: 'Volcanic archipelago' },
  { text: 'Narrow channels between Ndajdi rice paddies; a tax-collector\'s skiff demands toll in kind.', type: 'social', severity: 'mild', biome: 'Monsoon delta' },
]

export const CHOKEPOINT_BEATS: Beat[] = [
  { text: 'Lam-Chen pass guards demand toll in Qalībin salt-cubes, not coin. They weigh each cube on a brass scale.', type: 'social', severity: 'moderate' },
  { text: 'Rockfall blocks the trail; voices echo from above — survivors of yesterday\'s slide, or scavengers already picking?', type: 'environmental', severity: 'severe' },
  { text: 'Smith-pilgrim seeks an escort through the pass; carries ingots stamped with a dead khatt\'s seal. Trouble follows.', type: 'opportunity', severity: 'moderate' },
  { text: 'Maritime patrol from the Basin stops all traffic; searching for a smuggler of khatti letters of credit.', type: 'social', severity: 'severe' },
  { text: 'Mountain fog rolls in at midday; the cairn-marks are wrong, or someone moved them. The guide is praying.', type: 'environmental', severity: 'severe', timeOfDay: ['day'] },
  { text: 'River-crossing ferryman claims the current is too strong; wants double. The guide-rope looks badly frayed.', type: 'environmental', severity: 'moderate' },
  { text: 'A corpse at the pass mouth, stripped of boots and water-skin; the birds haven\'t found it yet, but the flies have.', type: 'environmental', severity: 'mild' },
  { text: 'Halkar Straits cyclone warning; vessels shelter in a cove where an old Oravan beacon still burns blue at dusk.', type: 'environmental', severity: 'severe', seasons: ['summer', 'autumn'], timeOfDay: ['dusk'] },
  { text: 'Bandit-sign scratched into the pass wall — three vertical lines, meaning "rich, armed, willing to talk".', type: 'social', severity: 'moderate' },
  { text: 'A Khazadari outpost offers hot tea and stale bread; the commander wants news from the southern road.', type: 'opportunity', severity: 'mild' },
  // Biome-specific chokepoint beats
  { text: 'The pass floor is loose scree over hardpan; every step kicks up alkali dust that blinds and chokes.', type: 'environmental', severity: 'moderate', biome: 'Desert' },
  { text: 'The cliff trail is a goat-track hacked into basalt; one misstep and the scree-slide carries you to the wadi floor.', type: 'environmental', severity: 'severe', biome: 'Escarpment' },
  { text: 'The gorge narrows to a single file between vertical walls; flash-flood roar from upstream — move or drown.', type: 'environmental', severity: 'severe', biome: 'River gorge' },
  { text: 'Above the tree line, frost heave has shattered the trail; every rock wobbles and the air is thin enough to cut.', type: 'environmental', severity: 'moderate', biome: 'Afroalpine heath' },
]

export const INTRA_CIV_BEATS: Beat[] = [
  { text: 'Oasis hospitality: the headman insists on three cups of sweet tea before any business is discussed.', type: 'social', severity: 'mild' },
  { text: 'Qalībin path-finder negotiation: she won\'t guide without a blood-oath, but her rate is half the khatt standard.', type: 'social', severity: 'moderate' },
  { text: 'Salt caravan crossing at dawn; the Irrah drivers sing a mourning hymn for the desert they left three weeks ago.', type: 'social', severity: 'mild', timeOfDay: ['dawn'] },
  { text: 'A tsetse-fly swarm rises from the Ndajdi canopy; the horses panic and the guide curses in three languages.', type: 'environmental', severity: 'moderate', seasons: ['spring', 'summer'] },
  { text: 'Local festival in the Kheshkai high pastures; every road is a dance floor and every merchant thinks they\'re a poet.', type: 'opportunity', severity: 'mild' },
  { text: 'Basin fever — two members of the party wake shivering. The Tavakh Qarat healer charges in letters of credit, not coin.', type: 'environmental', severity: 'severe', seasons: ['summer', 'autumn'], key: 'fever' },
  { text: 'Ngaru-Bon slate-quarry overseer mistakes you for escaped labour; his guards are poorly paid and well-armed.', type: 'combat', severity: 'severe' },
  { text: 'A Khazadari scholar by the roadside, measuring shadows with a brass astrolabe; she\'ll pay for fresh observations.', type: 'opportunity', severity: 'mild' },
  { text: 'Oravan fisher-folk offer dried wave-cod and rumours of a drowned city off the cape, visible only at low tide.', type: 'opportunity', severity: 'mild' },
  { text: 'Winter on the Copper for Steel Road: a frozen mule blocks the switchback, and wolf-tracks have been seen at dusk.', type: 'environmental', severity: 'moderate', seasons: ['winter'], timeOfDay: ['dusk'] },
  // Biome-specific intra-civ beats
  { text: 'Irrah well-keepers charge by the sip; their grandfather\'s grandfather dug this hole and the debt is hereditary.', type: 'social', severity: 'mild', biome: 'Oasis' },
  { text: 'Ndajdi charcoal-burners work the mangrove edge; they know every crocodile by sight and every smuggler by name.', type: 'social', severity: 'moderate', biome: 'Mangrove swamp' },
  { text: 'Qollari mushroom-gatherers mark their territory with coloured thread; cross the wrong colour and the spores answer.', type: 'environmental', severity: 'moderate', biome: 'Cloud forest' },
  { text: 'Ngaru-Bon pastoralists graze their long-horns on the high meadows; their dogs are bred to intimidate leopards.', type: 'social', severity: 'mild', biome: 'Highland savanna' },
  { text: 'Kheshkai felt-yurt encampment; the headman\'s daughter offers kumis and challenges the strongest to a wrestling match.', type: 'opportunity', severity: 'mild', biome: 'Steppe' },
  { text: 'Oravan hot-spring village; sulphur steam and fish-drying racks, and rumours of a drowned god in the caldera lake.', type: 'opportunity', severity: 'moderate', biome: 'Volcanic archipelago' },
  { text: 'Ndajdi floating market; produce sold from pole-boats, and the current carries away what the tide doesn\'t claim.', type: 'social', severity: 'mild', biome: 'Monsoon delta' },
]

export const NOTHING_BEATS: Beat[] = [
  { text: 'Uneventful leg. The road is quiet, the weather holds, and the only sound is your own footsteps.', type: 'environmental', severity: 'mild' },
  { text: 'Routine travel. Nothing of note disturbs the journey.', type: 'environmental', severity: 'mild' },
  { text: 'The trail is well-maintained and well-travelled. You make good time.', type: 'environmental', severity: 'mild' },
  // Biome-specific nothing beats
  { text: 'The dune crest holds its breath. Nothing moves but heat.', type: 'environmental', severity: 'mild', biome: 'Desert' },
  { text: 'Cracked salt pan stretches to the horizon. The earth breathes out alkali dust.', type: 'environmental', severity: 'mild', biome: 'Sabkha' },
  { text: 'Date palms rustle overhead. Water drips from a clay channel, slow and steady.', type: 'environmental', severity: 'mild', biome: 'Oasis' },
  { text: 'Tide is out. Mudskippers flicker across the flat and the roots are silent.', type: 'environmental', severity: 'mild', biome: 'Mangrove swamp' },
  { text: 'Wide brown water slides past without a ripple. The channel has not shifted today.', type: 'environmental', severity: 'mild', biome: 'Floodplain' },
  { text: 'Mist clings to the canopy. Somewhere a drip falls, then another, then nothing.', type: 'environmental', severity: 'mild', biome: 'Cloud forest' },
  { text: 'Grass stretches gold to the horizon. The wind passes through without troubling it.', type: 'environmental', severity: 'mild', biome: 'Highland savanna' },
  { text: 'Wind erosion has scoured the ridge to bare gravel. Not even a lizard stirs.', type: 'environmental', severity: 'mild', biome: 'Steppe' },
  { text: 'Pumice beach, grey and glassy. The tide withdraws with a sigh.', type: 'environmental', severity: 'mild', biome: 'Volcanic archipelago' },
  { text: 'Channels between the rice paddies run clear and slow. No boats pass.', type: 'environmental', severity: 'mild', biome: 'Monsoon delta' },
  { text: 'The cliff face is sheer and silent. A hawk turns on an updraft, then is gone.', type: 'environmental', severity: 'mild', biome: 'Escarpment' },
  { text: 'The gorge holds the river in shadow. The water mutters to itself, nothing more.', type: 'environmental', severity: 'mild', biome: 'River gorge' },
  { text: 'Tussock grass and stone. The air is thin and still, and the sky very close.', type: 'environmental', severity: 'mild', biome: 'Afroalpine heath' },
  // Biome + season specific nothing beats
  { text: 'The sand burns through boot-soles at noon. Even the flies have gone to ground.', type: 'environmental', severity: 'mild', biome: 'Desert', seasons: ['summer'] },
  { text: 'Frost rimes the dune-shadows at dawn. The desert does not forgive the cold either.', type: 'environmental', severity: 'mild', biome: 'Desert', seasons: ['winter'], timeOfDay: ['dawn'] },
  { text: 'Snow has erased the horizon. The wind carries nothing but the memory of grass.', type: 'environmental', severity: 'mild', biome: 'Steppe', seasons: ['winter'] },
  { text: 'Dry thunder rumbles to the north. The grass is brown and brittle underfoot.', type: 'environmental', severity: 'mild', biome: 'Steppe', seasons: ['summer'] },
  { text: 'Snow settles into the tussocks. The world has narrowed to the next cairn and the next.', type: 'environmental', severity: 'mild', biome: 'Afroalpine heath', seasons: ['winter'] },
  { text: 'Alpine gentians star the meadow. The silence is different here — thinner, older.', type: 'environmental', severity: 'mild', biome: 'Afroalpine heath', seasons: ['summer'] },
  { text: 'Rain does not fall; it simply is. Every surface weeps and the trail is mud.', type: 'environmental', severity: 'mild', biome: 'Cloud forest', seasons: ['winter'] },
  { text: 'Mist burns off by midday. For an hour the canopy is gold-green and loud with unseen birds.', type: 'environmental', severity: 'mild', biome: 'Cloud forest', seasons: ['summer'], timeOfDay: ['day'] },
  { text: 'The paddies are lakes. Rain falls in sheets that blur the boundary between sky and water.', type: 'environmental', severity: 'mild', biome: 'Monsoon delta', seasons: ['summer'] },
  { text: 'Harvest stubble smokes on the bunds. The channels run low and the mud holds the heat.', type: 'environmental', severity: 'mild', biome: 'Monsoon delta', seasons: ['winter'] },
]

/**
 * Quiet-leg beats for SEA legs (Oravan straits / Aethelian Basin crossings). The
 * land NOTHING_BEATS speak of roads and footsteps, which read wrong on open water;
 * a sea leg draws from these instead. Em-dash-free, grounded house voice.
 */
export const SEA_NOTHING_BEATS: Beat[] = [
  { text: 'A steady beam wind. The hull works quietly and the wake runs straight behind you.', type: 'environmental', severity: 'mild' },
  { text: 'Flat calm. The sail hangs slack and the sea lies like beaten pewter to every horizon.', type: 'environmental', severity: 'mild' },
  { text: 'The watch changes without a word. Only the creak of cordage and the slow lift of the swell.', type: 'environmental', severity: 'mild' },
  { text: 'A green thread of phosphorescence trails off the rudder. Nothing else stirs the dark water.', type: 'environmental', severity: 'mild', timeOfDay: ['night'] },
  { text: 'A far sail holds the same bearing all afternoon and never closes the distance.', type: 'environmental', severity: 'mild', timeOfDay: ['day'] },
  { text: 'Open water, an even swell. The leadsman finds no bottom and the nakhoda is content.', type: 'environmental', severity: 'mild' },
  { text: 'The trade wind holds fair and dry. You log good distance and the casks stay full.', type: 'environmental', severity: 'mild', seasons: ['summer'] },
  { text: 'A cold grey sea and a reefed sail. The crossing is slow, but the straits stay open.', type: 'environmental', severity: 'mild', seasons: ['winter'] },
]

export function poolForEdgeType(type: string): Beat[] {
  switch (type) {
    case 'trade_route': return TRADE_ROUTE_BEATS
    case 'chokepoint': return CHOKEPOINT_BEATS
    case 'intra_civ': return INTRA_CIV_BEATS
    default: return INTRA_CIV_BEATS
  }
}

export function filterBySeason(pool: Beat[], season?: Season): Beat[] {
  if (!season) return pool
  const general = pool.filter(b => !b.seasons && !b.excludeSeasons)
  const specific = pool.filter(b => {
    if (b.seasons && !b.seasons.includes(season)) return false
    if (b.excludeSeasons && b.excludeSeasons.includes(season)) return false
    return true
  })
  // If there are season-specific beats, mix them in heavily so they surface
  return specific.length > 0 ? [...specific, ...general] : general
}

/**
 * Filter a pool by biome.
 *
 * If `biome` is provided and the pool contains at least one beat tagged
 * with that biome, return only the matching beats.
 * Otherwise return the full pool unchanged (fallback to region-wide table).
 */
export function filterByBiome(pool: Beat[], biome?: string): Beat[] {
  if (!biome) return pool
  const matched = pool.filter(b => b.biome === biome)
  return matched.length > 0 ? matched : pool
}

/**
 * Filter nothing beats by biome.
 *
 * If `biome` is provided and at least one nothing beat is tagged for it,
 * return only those. Otherwise return the generic (untagged) beats.
 * If no biome is provided, only generic beats are returned.
 */
export function filterNothingBeats(biome?: string, season?: Season, sea = false): Beat[] {
  // A quiet sea crossing reads as open water, not a quiet road.
  if (sea) return filterBySeason(SEA_NOTHING_BEATS, season)
  const generic = NOTHING_BEATS.filter(b => !b.biome)
  if (!biome) return filterBySeason(generic, season)
  const matched = NOTHING_BEATS.filter(b => b.biome === biome)
  return filterBySeason(matched.length > 0 ? matched : generic, season)
}

/* ─── Time of day ─── */

/**
 * Time-flavored prose that REPLACES an encounter's beat text when it rolls a
 * non-day time. Matched by (type, time); the base beat's severity, type, and
 * biome are preserved, so this only changes the displayed prose — never the
 * sim's supply/danger aggregates. Kept severity-neutral so any base severity
 * reads fine. Authored as a separate overlay, never mixed into the draw pools
 * (mixing would change pool length and perturb the beat-selection RNG stream).
 */
export const TIME_OF_DAY_BEATS: Array<{ text: string; type: Encounter['type']; times: TimeOfDay[] }> = [
  // combat
  { text: 'They come at the edge of the firelight — the watch is roused a heartbeat before the first arrow.', type: 'combat', times: ['night'] },
  { text: 'The ambush springs at last light, when the eye can no longer tell a friend from a standing stone.', type: 'combat', times: ['dusk'] },
  { text: 'Grey dawn reveals the trap already laid — figures rise from the cold ground on every side.', type: 'combat', times: ['dawn'] },
  // social
  { text: 'A lantern bobs up the dark road; whoever carries it wants your fire, and a share of your news.', type: 'social', times: ['night'] },
  { text: 'As camp is struck at dusk a stranger drifts in off the trail, asking to share the road come morning.', type: 'social', times: ['dusk'] },
  { text: 'They are waiting at the dawn cookfire already, having walked through the night to reach you.', type: 'social', times: ['dawn'] },
  // environmental
  { text: 'The trail all but vanishes in the dark; every footfall is a wager against the drop on the left.', type: 'environmental', times: ['night'] },
  { text: 'Failing light flattens the ground to a single grey plane — path and hazard become one.', type: 'environmental', times: ['dusk'] },
  { text: 'First light shows what the dark hid: the way ahead is washed out, and the detour is on no map.', type: 'environmental', times: ['dawn'] },
  // opportunity
  { text: 'A cookfire smokes off the trail in the dark; whoever keeps it has what you lack, if you can deal.', type: 'opportunity', times: ['night'] },
  { text: 'Dusk light catches something off the path — worth the short climb before the dark closes in.', type: 'opportunity', times: ['dusk'] },
  { text: 'Dawn dew shows fresh tracks, broken not an hour past; someone moved in the night and left a trail.', type: 'opportunity', times: ['dawn'] },
]

/** Decorrelates the time-of-day seed from the beat-selection seed (golden ratio). */
const TOD_SEED_OFFSET = 0x9e3779b9
/** Chance a non-day, non-prose-anchored encounter gets time-flavored prose. */
const TIME_OVERLAY_CHANCE = 0.6

/** Weighted time-of-day roll: most travel is by day, so night reads as special. */
function pickWeightedTime(rng: () => number): TimeOfDay {
  const r = rng()
  if (r < 0.50) return 'day'
  if (r < 0.67) return 'dawn'
  if (r < 0.84) return 'dusk'
  return 'night'
}

/** Time-of-day for a beat: its prose-anchored time if set, else a weighted roll. */
export function pickEncounterTime(beat: Beat, rng: () => number): TimeOfDay {
  return beat.timeOfDay && beat.timeOfDay.length > 0
    ? beat.timeOfDay[Math.floor(rng() * beat.timeOfDay.length)]
    : pickWeightedTime(rng)
}

function timeOverlayFor(type: Encounter['type'], time: TimeOfDay, rng: () => number): string | undefined {
  if (time === 'day') return undefined
  const matches = TIME_OF_DAY_BEATS.filter(b => b.type === type && b.times.includes(time))
  if (matches.length === 0) return undefined
  return matches[Math.floor(rng() * matches.length)].text
}

/**
 * Build an Encounter from a chosen Beat. Time-of-day (and any time-flavored
 * prose overlay) are derived from `todSeed` — a SEPARATE mulberry32 instance —
 * so the caller's beat-selection RNG stream, and therefore severity / type /
 * supplyCost and the sim baseline, are never perturbed. `allowOverlay` is false
 * for "nothing" filler beats (a quiet leg shouldn't morph into a night ambush).
 */
function makeEncounter(beat: Beat, segmentIdx: number, todSeed: number, allowOverlay: boolean): Encounter {
  const todRng = mulberry32(todSeed)
  const time = pickEncounterTime(beat, todRng)
  let text = beat.text
  // Signature beats (key in SIGNATURE_CHOICES) drive a choice prompt, so their prose
  // must stay coherent with the options — never swap it for a generic time overlay.
  if (allowOverlay && !beat.timeOfDay && !beat.key && time !== 'day' && todRng() < TIME_OVERLAY_CHANCE) {
    const overlay = timeOverlayFor(beat.type, time, todRng)
    if (overlay) text = overlay
  }
  return {
    segmentIdx,
    beat: text,
    type: beat.type,
    severity: beat.severity,
    narrative: text,
    biome: beat.biome,
    key: beat.key,
    supplyCost: severityCost(beat.severity),
    timeOfDay: time,
  }
}

/* ─── Public API ─── */

/** The basin node carries civ === its id; alias it to the canon sea-civ so the
 *  Aethelian at-sea sightings (civ: 'aethelian') can match a basin-touching leg. */
const CIV_ALIAS_FOR_EXTERNAL: Record<string, string> = { aethelian_basin: 'aethelian' }

/**
 * The beat pool for one leg. On a SEA leg the land caravan/bandit beats are wrong,
 * so we draw from the water-civ's external sea beats instead (megafauna sightings,
 * island/outrigger beats). Falls back to the normal land pool when external data is
 * OFF (the Node sim never loads it) so the sim baseline stays byte-identical; on a
 * non-sea leg this is exactly the prior augmentPoolWithWeighted behaviour.
 *
 * Determinism: this only changes WHICH array the single seeded pick indexes into —
 * no rng() call is added or removed.
 */
function poolForLeg(
  edge: JourneyEdge,
  edgeCivs: (string | undefined)[],
  biome: string | undefined,
  season: Season | undefined,
  sea: boolean,
): Beat[] {
  const opts = sea ? { seaChokepoint: true } : undefined
  if (sea) {
    const seaBeats = externalBeatsFor(edgeCivs, edge.type, biome, opts)
    if (seaBeats.length) return seaBeats
  }
  return augmentPoolWithWeighted(
    filterByBiome(filterBySeason(poolForEdgeType(edge.type), season), biome),
    edgeCivs, edge.type, biome, opts,
  )
}

export function generateEncounters(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct',
  edgeBiomes?: (string | undefined)[]
): Encounter[] {
  const sig = route.nodes.map(n => n.id).join('|') + '#' + (season || 'any') + '#' + mode
  const seed = djb2Hash(sig)
  const rng = mulberry32(seed)
  const todBase = seed ^ TOD_SEED_OFFSET
  const nodeOf = new Map(route.nodes.map(n => [n.id, n]))

  const encounters: Encounter[] = []

  for (let i = 0; i < route.edges.length; i++) {
    const edge = route.edges[i]
    const fromNode = nodeOf.get(edge.from)
    const toNode = nodeOf.get(edge.to)
    const sea = isSeaLeg(fromNode, toNode)
    // The basin is ingested as a node whose civ is its id (`aethelian_basin`), so
    // the Aethelian sea-fauna rows (civ: 'aethelian') would never match. Alias it
    // for external matching only — a no-op on every non-basin leg.
    const edgeCivs = [fromNode?.civ, toNode?.civ].map(c => (c && CIV_ALIAS_FOR_EXTERNAL[c]) || c)
    const pool = poolForLeg(edge, edgeCivs, edgeBiomes?.[i], season, sea)

    // Roll: 30% chance of nothing on trade routes, 15% on chokepoints, 40% on intra-civ
    const nothingChance = edge.type === 'chokepoint' ? 0.15 : edge.type === 'trade_route' ? 0.30 : 0.40
    if (rng() < nothingChance) {
      const nothingPool = filterNothingBeats(edgeBiomes?.[i], season, sea)
      const nothing = nothingPool[Math.floor(rng() * nothingPool.length)]
      encounters.push(makeEncounter(nothing, i, todBase + i * 131, false))
      continue
    }

    const beat = pool[Math.floor(rng() * pool.length)]
    encounters.push(makeEncounter(beat, i, todBase + i * 131 + 977, true))

    // Long legs get a second encounter
    if ((edge.segmentDays || 0) > 5) {
      const secondRng = mulberry32(seed + i + 10007)
      if (secondRng() >= nothingChance) {
        const secondPool = poolForLeg(edge, edgeCivs, edgeBiomes?.[i], season, sea)
        const beat2 = secondPool[Math.floor(secondRng() * secondPool.length)]
        encounters.push(makeEncounter(beat2, i, todBase + i * 131 + 1954, true))
      }
    }
  }

  return encounters
}

export function encounterTypeIcon(type: Encounter['type']): string {
  switch (type) {
    case 'social': return '◎'
    case 'environmental': return '❋'
    case 'combat': return '✦'
    case 'opportunity': return '◈'
    default: return '•'
  }
}

export function encounterSeverityLabel(severity: Encounter['severity']): string {
  switch (severity) {
    case 'mild': return 'Mild'
    case 'moderate': return 'Moderate'
    case 'severe': return 'Severe'
    default: return ''
  }
}
