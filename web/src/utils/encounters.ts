/**
 * encounters.ts — Deterministic encounter generator for Journey Mode
 *
 * Given a route, season, and travel mode, produces a reproducible set of
 * encounter beats seeded by the route signature. Same route → same encounters.
 *
 * The beats are hand-authored lore seeds, not finished prose. The GM dresses them.
 */

import type { JourneyRoute, Season, RouteMode } from './journey-graph'

export interface Encounter {
  segmentIdx: number
  beat: string
  type: 'social' | 'environmental' | 'combat' | 'opportunity'
  severity: 'mild' | 'moderate' | 'severe'
  narrative: string
  /** If this encounter was drawn from a biome-specific beat, the biome name. */
  biome?: string
}

/* ─── Seeded RNG ─── */

function djb2Hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i)
  }
  return h >>> 0
}

function mulberry32(a: number) {
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
}

export const TRADE_ROUTE_BEATS: Beat[] = [
  { text: 'Copper merchant from the Irrah salt-flats offers passage in exchange for a letter of introduction.', type: 'social', severity: 'mild' },
  { text: 'Khazadari money-changer sets up a folding table at the crossroads; rates favour khatti credit over coin.', type: 'social', severity: 'mild' },
  { text: 'Qalībin path-finder argues the mapped trail is wrong — knows a dry wadi that cuts two days if you trust her.', type: 'opportunity', severity: 'moderate' },
  { text: 'Oravan wave-tithe collector boards the coastal leg; demands duty or a convincing story.', type: 'social', severity: 'moderate' },
  { text: 'Ndajdi foresters demand a "green toll" — payment in seed or labour, not metal.', type: 'social', severity: 'mild' },
  { text: 'Caravan of Kheshkai wool-merchants overtakes you at dawn; their pace reveals a hidden watering hole.', type: 'opportunity', severity: 'mild' },
  { text: 'Ngaru-Bon slate-porters refuse to share the trail; their loads are fragile and their tempers shorter.', type: 'social', severity: 'moderate' },
  { text: 'A broken axle on a southbound steel cart blocks the Copper for Steel Road; the smith\'s apprentice weeps openly.', type: 'environmental', severity: 'moderate' },
  { text: 'Spring floods have washed out the ford; an Irrah guide offers to swim the rope across for a salt-cube fee.', type: 'environmental', severity: 'moderate', seasons: ['spring'] },
  { text: 'Summer heat warps the horizon; a mirage shows the Tavakh Qarat spires where no citadel has ever stood.', type: 'environmental', severity: 'mild', seasons: ['summer'] },
  { text: 'Autumn mud on the Basin track swallows cart-wheels whole; a Qalībin crew will winch you out for a favour owed.', type: 'environmental', severity: 'moderate', seasons: ['autumn'] },
  { text: 'Winter ice sheaths the mountain road; a Khazadari patrol passes in silence, their yak-hair boots making no sound.', type: 'environmental', severity: 'mild', seasons: ['winter'] },
  { text: 'Banditry: masked riders fan out from a Ngaru-Bon scrub-line and demand the strongbox by the count of three. They know your cargo manifest by name.', type: 'combat', severity: 'severe' },
  { text: 'A Basin customs raid surrounds the caravan at dawn — letters of credit are seized for "audit", and the senior scribe is meant to ride back to the Tavakh Qarat under guard.', type: 'social', severity: 'severe' },
  { text: 'Plague-quarantine: an Irrah salt-flats outrider blocks the road with a red banner. No party crosses without a fortnight\'s wait at the cordon, or a forged seal of clean passage.', type: 'environmental', severity: 'severe' },
  // Biome-specific trade-route beats
  { text: 'A sand-wraith rides the dune-crest at noon — heat-shimmer or spirit, the caravan master will not wait to find out.', type: 'environmental', severity: 'moderate', biome: 'Desert' },
  { text: 'The salt-crust crunches under wheel; a sabkha sinkhole opens, swallowing the rear cart whole.', type: 'environmental', severity: 'severe', biome: 'Sabkha' },
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
  { text: 'Mountain fog rolls in at midday; the cairn-marks are wrong, or someone moved them. The guide is praying.', type: 'environmental', severity: 'severe' },
  { text: 'River-crossing ferryman claims the current is too strong; wants double. The guide-rope looks badly frayed.', type: 'environmental', severity: 'moderate' },
  { text: 'A corpse at the pass mouth, stripped of boots and water-skin; the birds haven\'t found it yet, but the flies have.', type: 'environmental', severity: 'mild' },
  { text: 'Halkar Straits cyclone warning; vessels shelter in a cove where an old Oravan beacon still burns blue at dusk.', type: 'environmental', severity: 'severe', seasons: ['summer', 'autumn'] },
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
  { text: 'Salt caravan crossing at dawn; the Irrah drivers sing a mourning hymn for the desert they left three weeks ago.', type: 'social', severity: 'mild' },
  { text: 'A tsetse-fly swarm rises from the Ndajdi canopy; the horses panic and the guide curses in three languages.', type: 'environmental', severity: 'moderate', seasons: ['spring', 'summer'] },
  { text: 'Local festival in the Kheshkai high pastures; every road is a dance floor and every merchant thinks they\'re a poet.', type: 'opportunity', severity: 'mild' },
  { text: 'Basin fever — two members of the party wake shivering. The Tavakh Qarat healer charges in letters of credit, not coin.', type: 'environmental', severity: 'severe', seasons: ['summer', 'autumn'] },
  { text: 'Ngaru-Bon slate-quarry overseer mistakes you for escaped labour; his guards are poorly paid and well-armed.', type: 'combat', severity: 'severe' },
  { text: 'A Khazadari scholar by the roadside, measuring shadows with a brass astrolabe; she\'ll pay for fresh observations.', type: 'opportunity', severity: 'mild' },
  { text: 'Oravan fisher-folk offer dried wave-cod and rumours of a drowned city off the cape, visible only at low tide.', type: 'opportunity', severity: 'mild' },
  { text: 'Winter on the Copper for Steel Road: a frozen mule blocks the switchback, and wolf-tracks have been seen at dusk.', type: 'environmental', severity: 'moderate', seasons: ['winter'] },
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
  { text: 'Frost rimes the dune-shadows at dawn. The desert does not forgive the cold either.', type: 'environmental', severity: 'mild', biome: 'Desert', seasons: ['winter'] },
  { text: 'Snow has erased the horizon. The wind carries nothing but the memory of grass.', type: 'environmental', severity: 'mild', biome: 'Steppe', seasons: ['winter'] },
  { text: 'Dry thunder rumbles to the north. The grass is brown and brittle underfoot.', type: 'environmental', severity: 'mild', biome: 'Steppe', seasons: ['summer'] },
  { text: 'Snow settles into the tussocks. The world has narrowed to the next cairn and the next.', type: 'environmental', severity: 'mild', biome: 'Afroalpine heath', seasons: ['winter'] },
  { text: 'Alpine gentians star the meadow. The silence is different here — thinner, older.', type: 'environmental', severity: 'mild', biome: 'Afroalpine heath', seasons: ['summer'] },
  { text: 'Rain does not fall; it simply is. Every surface weeps and the trail is mud.', type: 'environmental', severity: 'mild', biome: 'Cloud forest', seasons: ['winter'] },
  { text: 'Mist burns off by midday. For an hour the canopy is gold-green and loud with unseen birds.', type: 'environmental', severity: 'mild', biome: 'Cloud forest', seasons: ['summer'] },
  { text: 'The paddies are lakes. Rain falls in sheets that blur the boundary between sky and water.', type: 'environmental', severity: 'mild', biome: 'Monsoon delta', seasons: ['summer'] },
  { text: 'Harvest stubble smokes on the bunds. The channels run low and the mud holds the heat.', type: 'environmental', severity: 'mild', biome: 'Monsoon delta', seasons: ['winter'] },
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
export function filterNothingBeats(biome?: string, season?: Season): Beat[] {
  const generic = NOTHING_BEATS.filter(b => !b.biome)
  if (!biome) return filterBySeason(generic, season)
  const matched = NOTHING_BEATS.filter(b => b.biome === biome)
  return filterBySeason(matched.length > 0 ? matched : generic, season)
}

/* ─── Public API ─── */

export function generateEncounters(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct',
  edgeBiomes?: (string | undefined)[]
): Encounter[] {
  const sig = route.nodes.map(n => n.id).join('|') + '#' + (season || 'any') + '#' + mode
  const seed = djb2Hash(sig)
  const rng = mulberry32(seed)

  const encounters: Encounter[] = []

  for (let i = 0; i < route.edges.length; i++) {
    const edge = route.edges[i]
    const pool = filterByBiome(filterBySeason(poolForEdgeType(edge.type), season), edgeBiomes?.[i])

    // Roll: 30% chance of nothing on trade routes, 15% on chokepoints, 40% on intra-civ
    const nothingChance = edge.type === 'chokepoint' ? 0.15 : edge.type === 'trade_route' ? 0.30 : 0.40
    if (rng() < nothingChance) {
      const nothingPool = filterNothingBeats(edgeBiomes?.[i], season)
      const nothing = nothingPool[Math.floor(rng() * nothingPool.length)]
      encounters.push({
        segmentIdx: i,
        beat: nothing.text,
        type: nothing.type,
        severity: nothing.severity,
        narrative: nothing.text,
        biome: nothing.biome,
      })
      continue
    }

    const beat = pool[Math.floor(rng() * pool.length)]
    encounters.push({
      segmentIdx: i,
      beat: beat.text,
      type: beat.type,
      severity: beat.severity,
      narrative: beat.text,
      biome: beat.biome,
    })

    // Long legs get a second encounter
    if ((edge.segmentDays || 0) > 5) {
      const secondRng = mulberry32(seed + i + 10007)
      if (secondRng() >= nothingChance) {
        const secondPool = filterByBiome(filterBySeason(poolForEdgeType(edge.type), season), edgeBiomes?.[i])
        const beat2 = secondPool[Math.floor(secondRng() * secondPool.length)]
        encounters.push({
          segmentIdx: i,
          beat: beat2.text,
          type: beat2.type,
          severity: beat2.severity,
          narrative: beat2.text,
          biome: beat2.biome,
        })
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
