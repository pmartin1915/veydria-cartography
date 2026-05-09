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
]

const NOTHING_BEATS: Beat[] = [
  { text: 'Uneventful leg. The road is quiet, the weather holds, and the only sound is your own footsteps.', type: 'environmental', severity: 'mild' },
  { text: 'Routine travel. Nothing of note disturbs the journey.', type: 'environmental', severity: 'mild' },
  { text: 'The trail is well-maintained and well-travelled. You make good time.', type: 'environmental', severity: 'mild' },
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

/* ─── Public API ─── */

export function generateEncounters(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct'
): Encounter[] {
  const sig = route.nodes.map(n => n.id).join('|') + '#' + (season || 'any') + '#' + mode
  const seed = djb2Hash(sig)
  const rng = mulberry32(seed)

  const encounters: Encounter[] = []

  for (let i = 0; i < route.edges.length; i++) {
    const edge = route.edges[i]
    const pool = filterBySeason(poolForEdgeType(edge.type), season)

    // Roll: 30% chance of nothing on trade routes, 15% on chokepoints, 40% on intra-civ
    const nothingChance = edge.type === 'chokepoint' ? 0.15 : edge.type === 'trade_route' ? 0.30 : 0.40
    if (rng() < nothingChance) {
      const nothing = NOTHING_BEATS[Math.floor(rng() * NOTHING_BEATS.length)]
      encounters.push({ segmentIdx: i, beat: nothing.text, type: nothing.type, severity: nothing.severity, narrative: nothing.text })
      continue
    }

    const beat = pool[Math.floor(rng() * pool.length)]
    encounters.push({
      segmentIdx: i,
      beat: beat.text,
      type: beat.type,
      severity: beat.severity,
      narrative: beat.text,
    })

    // Long legs get a second encounter
    if ((edge.segmentDays || 0) > 5) {
      const secondRng = mulberry32(seed + i + 10007)
      if (secondRng() >= nothingChance) {
        const secondPool = filterBySeason(poolForEdgeType(edge.type), season)
        const beat2 = secondPool[Math.floor(secondRng() * secondPool.length)]
        encounters.push({
          segmentIdx: i,
          beat: beat2.text,
          type: beat2.type,
          severity: beat2.severity,
          narrative: beat2.text,
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
