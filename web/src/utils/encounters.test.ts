import { describe, it, expect } from 'vitest'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel, severityCost, NOTHING_BEATS, filterNothingBeats, pickEncounterTime, TIME_OF_DAY_BEATS, type Beat } from './encounters'
import { TIME_OF_DAY_ORDER } from './time-of-day'
import type { JourneyRoute } from './journey-graph'

function fakeRoute(): JourneyRoute {
  return {
    nodes: [
      { id: 'a', name: 'A', category: 'port', x: 0, y: 0 },
      { id: 'b', name: 'B', category: 'civilization', x: 100, y: 0 },
      { id: 'c', name: 'C', category: 'oasis', x: 200, y: 0 },
    ],
    edges: [
      { from: 'a', to: 'b', distanceSvg: 100, type: 'trade_route', name: 'AB', segmentDays: 2 },
      { from: 'b', to: 'c', distanceSvg: 100, type: 'chokepoint', name: 'BC', segmentDays: 3 },
    ],
    totalDistanceSvg: 200,
    totalKm: 200,
    estimatedDays: 5,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

function fakeRouteManyEdges(count: number, type: 'trade_route' | 'chokepoint' | 'intra_civ' = 'intra_civ'): JourneyRoute {
  const nodes = Array.from({ length: count + 1 }, (_, i) => ({
    id: `n${i}`,
    name: `N${i}`,
    category: 'civilization' as const,
    x: i * 100,
    y: 0,
  }))
  const edges = Array.from({ length: count }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    distanceSvg: 100,
    type,
    name: `E${i}`,
    segmentDays: 2,
  }))
  return {
    nodes,
    edges,
    totalDistanceSvg: count * 100,
    totalKm: count * 100,
    estimatedDays: count * 2,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

describe('encounters', () => {
  it('is deterministic across calls', () => {
    const r = fakeRoute()
    const a = generateEncounters(r, 'spring', 'direct')
    const b = generateEncounters(r, 'spring', 'direct')
    expect(a).toEqual(b)
  })

  it('changes when season changes', () => {
    const r = fakeRoute()
    const spring = generateEncounters(r, 'spring', 'direct')
    const winter = generateEncounters(r, 'winter', 'direct')
    expect(spring).not.toEqual(winter)
  })

  it('returns clean unicode (no emoji) icons for markdown export', () => {
    // Markdown export depends on encounterTypeIcon returning string glyphs
    // that survive copy-paste; surrogate pairs from emoji fonts ruin alignment.
    const icons = ['social', 'environmental', 'combat', 'opportunity'] as const
    for (const t of icons) {
      const icon = encounterTypeIcon(t)
      expect(icon.length).toBeLessThanOrEqual(2)
    }
  })

  it('severity labels are non-empty', () => {
    expect(encounterSeverityLabel('mild')).toBe('Mild')
    expect(encounterSeverityLabel('moderate')).toBe('Moderate')
    expect(encounterSeverityLabel('severe')).toBe('Severe')
  })

  it('severityCost is deterministic by severity', () => {
    expect(severityCost('mild')).toEqual({ rations: 0, water: 0 })
    expect(severityCost('moderate')).toEqual({ rations: 1, water: 1 })
    expect(severityCost('severe')).toEqual({ rations: 2, water: 2 })
  })

  it('generateEncounters populates supplyCost on every encounter', () => {
    // Mix of biome-filtered, season-filtered, and long-edge routes so we
    // exercise every push site in generateEncounters.
    const routes: JourneyRoute[] = [
      fakeRoute(),
      fakeRouteManyEdges(6, 'chokepoint'),
      fakeRouteManyEdges(4, 'intra_civ'),
      fakeRouteManyEdges(3, 'trade_route'),
    ]
    let total = 0
    for (const r of routes) {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
        const encs = generateEncounters(r, season, 'direct')
        for (const e of encs) {
          total++
          expect(e.supplyCost).toEqual(severityCost(e.severity))
        }
      }
    }
    // Sanity that the loop actually exercised encounters.
    expect(total).toBeGreaterThan(0)
  })

  it('is deterministic when edgeBiomes are provided', () => {
    const r = fakeRoute()
    const a = generateEncounters(r, 'spring', 'direct', ['Desert', 'Desert'])
    const b = generateEncounters(r, 'spring', 'direct', ['Desert', 'Desert'])
    expect(a).toEqual(b)
  })

  it('narrows pool when edgeBiome matches', () => {
    const r = fakeRoute()
    const noBiome = generateEncounters(r, 'spring', 'direct')
    const withBiome = generateEncounters(r, 'spring', 'direct', ['Desert', 'Desert'])
    // Same seed, same route — but with a matching biome the pool is narrowed,
    // so the outcome should differ (or at least the deterministic RNG path
    // diverges because pool.length changes).
    expect(withBiome).not.toEqual(noBiome)
  })

  it('falls back to full pool when edgeBiome has no matching beats', () => {
    const r = fakeRoute()
    const noBiome = generateEncounters(r, 'spring', 'direct')
    const unknown = generateEncounters(r, 'spring', 'direct', ['NonExistent', 'NonExistent'])
    expect(unknown).toEqual(noBiome)
  })

  it('populates biome field when a biome-specific beat is selected', () => {
    // Force a route where edge 0 is Desert so we only get Desert beats.
    // The first edge is trade_route; Desert trade-route beats exist.
    const r = fakeRoute()
    const encs = generateEncounters(r, 'spring', 'direct', ['Desert', 'Desert'])
    // At least one encounter should surface (30% nothing chance on trade_route)
    // If we got encounters, verify biome is present on the non-nothing ones.
    const nonNothing = encs.filter(e => !e.beat.includes('Uneventful') && !e.beat.includes('Routine') && !e.beat.includes('well-maintained'))
    for (const e of nonNothing) {
      expect(e.biome).toBeDefined()
    }
  })

  it('biome field is undefined for generic nothing beats', () => {
    const genericTexts = new Set(NOTHING_BEATS.filter(b => !b.biome).map(b => b.text))
    const r = fakeRouteManyEdges(10, 'intra_civ')
    const encs = generateEncounters(r, 'spring', 'direct', Array(10).fill('NonExistent'))
    const nothingEncs = encs.filter(e => genericTexts.has(e.beat))
    expect(nothingEncs.length).toBeGreaterThan(0)
    for (const e of nothingEncs) {
      expect(e.biome).toBeUndefined()
    }
  })

  it('uses biome-specific nothing beats when edgeBiome matches', () => {
    const biomeTexts = new Set(NOTHING_BEATS.filter(b => b.biome === 'Desert').map(b => b.text))
    const r = fakeRouteManyEdges(10, 'intra_civ')
    const encs = generateEncounters(r, 'spring', 'direct', Array(10).fill('Desert'))
    const nothingEncs = encs.filter(e => biomeTexts.has(e.beat))
    expect(nothingEncs.length).toBeGreaterThan(0)
    for (const e of nothingEncs) {
      expect(e.biome).toBe('Desert')
    }
  })

  it('uses only generic nothing beats when no edgeBiomes are provided', () => {
    const genericTexts = new Set(NOTHING_BEATS.filter(b => !b.biome).map(b => b.text))
    const r = fakeRouteManyEdges(10, 'intra_civ')
    const encs = generateEncounters(r, 'spring', 'direct')
    const nothingEncs = encs.filter(e => genericTexts.has(e.beat))
    expect(nothingEncs.length).toBeGreaterThan(0)
    for (const e of nothingEncs) {
      expect(e.biome).toBeUndefined()
    }
  })

  it('selects season-specific nothing beats when biome and season both match', () => {
    const desertSummer = NOTHING_BEATS.filter(b => b.biome === 'Desert' && b.seasons?.includes('summer'))
    expect(desertSummer.length).toBeGreaterThan(0)
    const r = fakeRouteManyEdges(30, 'intra_civ')
    const encs = generateEncounters(r, 'summer', 'direct', Array(30).fill('Desert'))
    const matched = encs.filter(e => desertSummer.some(b => b.text === e.beat))
    expect(matched.length).toBeGreaterThan(0)
    for (const e of matched) {
      expect(e.biome).toBe('Desert')
    }
  })

  it('falls back to biome-only nothing beats when season has no specific entries', () => {
    // Sabkha has biome-specific but no season-specific nothing beats
    const sabkhaBeats = NOTHING_BEATS.filter(b => b.biome === 'Sabkha')
    expect(sabkhaBeats.length).toBe(1)
    expect(sabkhaBeats[0].seasons).toBeUndefined()
    const r = fakeRouteManyEdges(30, 'intra_civ')
    const encs = generateEncounters(r, 'summer', 'direct', Array(30).fill('Sabkha'))
    const matched = encs.filter(e => sabkhaBeats.some(b => b.text === e.beat))
    expect(matched.length).toBeGreaterThan(0)
    for (const e of matched) {
      expect(e.biome).toBe('Sabkha')
    }
  })

  it('filterNothingBeats returns only generic beats when no biome given regardless of season', () => {
    const result = filterNothingBeats(undefined, 'summer')
    expect(result.every(b => !b.biome)).toBe(true)
    const genericTexts = NOTHING_BEATS.filter(b => !b.biome).map(b => b.text)
    expect(result.map(b => b.text)).toEqual(expect.arrayContaining(genericTexts))
  })

  /* ─── Time of day ─── */

  it('every encounter carries a valid timeOfDay', () => {
    const r = fakeRouteManyEdges(12, 'trade_route')
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      for (const enc of generateEncounters(r, season, 'direct')) {
        expect(TIME_OF_DAY_ORDER).toContain(enc.timeOfDay)
      }
    }
  })

  it('timeOfDay is deterministic across calls (covered by the per-field equality)', () => {
    const r = fakeRouteManyEdges(8, 'intra_civ')
    const a = generateEncounters(r, 'autumn', 'safest').map(e => e.timeOfDay)
    const b = generateEncounters(r, 'autumn', 'safest').map(e => e.timeOfDay)
    expect(a).toEqual(b)
  })

  it('pickEncounterTime honours a prose-anchored beat regardless of rng', () => {
    const anchored: Beat = { text: 'blue at dusk', type: 'environmental', severity: 'mild', timeOfDay: ['dusk'] }
    // Any rng value must still yield the anchored time.
    for (const v of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickEncounterTime(anchored, () => v)).toBe('dusk')
    }
  })

  it('pickEncounterTime weighted-rolls a valid time for an unanchored beat', () => {
    const plain: Beat = { text: 'x', type: 'social', severity: 'mild' }
    for (const v of [0, 0.4, 0.6, 0.75, 0.95]) {
      expect(TIME_OF_DAY_ORDER).toContain(pickEncounterTime(plain, () => v))
    }
  })

  it('time-flavored overlay never changes type/severity (sim-safety invariant)', () => {
    // Any encounter whose beat text is a TIME_OF_DAY_BEATS overlay must keep a
    // type that matches the overlay entry, and a non-day time that the entry
    // covers — proving the overlay matched on (type, time) and left severity
    // sourced from the base draw (which feeds supplyCost, hence the sim).
    const overlayByText = new Map(TIME_OF_DAY_BEATS.map(b => [b.text, b]))
    const r = fakeRouteManyEdges(20, 'trade_route')
    let sawOverlay = false
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      for (const enc of generateEncounters(r, season, 'direct')) {
        const ov = overlayByText.get(enc.beat)
        if (!ov) continue
        sawOverlay = true
        expect(ov.type).toBe(enc.type)
        expect(enc.timeOfDay).not.toBe('day')
        expect(ov.times).toContain(enc.timeOfDay)
        expect(enc.supplyCost).toEqual(severityCost(enc.severity))
      }
    }
    expect(sawOverlay).toBe(true) // sanity: the overlay actually fired
  })
})
