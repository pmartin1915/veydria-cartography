import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRouteWithFallback, isSeaLeg } from './journey-graph'
import { generateEncounters } from './encounters'
import { setExternalEncounters, type ExternalEncounterFile } from './external-encounters'
import { SIGHTING_FAUNA } from './sea-sightings'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, p), 'utf-8'))
const geojson = read('../../public/veydria-spatial.geojson')
const encountersFile = read('../../public/encounters.json') as ExternalEncounterFile

// End-to-end on the REAL canon: proves the crossing is reachable in the actual graph
// (plan risk #1) and that a megafauna sighting genuinely fires once the real
// encounters.json is armed. Without the basin civ alias the second test would fail
// (the Aethelian sightings would never match), so this guards the activation too.
describe('sea sightings — real canon end to end', () => {
  const graph = buildGraph(geojson)

  it('an Oravan ↔ Aethelian Basin route contains a sea leg', () => {
    const r = findRouteWithFallback(graph, 'oravan', 'aethelian_basin').route
    expect(r).not.toBeNull()
    const hasSea = r!.edges.some((e) => {
      const f = r!.nodes.find((n) => n.id === e.from)
      const t = r!.nodes.find((n) => n.id === e.to)
      return isSeaLeg(f, t)
    })
    expect(hasSea).toBe(true)
  })

  it('a megafauna sighting fires on the crossing with the real encounter canon armed', () => {
    setExternalEncounters(encountersFile)
    try {
      const sightingKeys = new Set(Object.keys(SIGHTING_FAUNA))
      const seasons = [undefined, 'spring', 'summer', 'autumn', 'winter'] as const
      const fired = seasons.some((s) => {
        const r = findRouteWithFallback(graph, 'oravan', 'aethelian_basin', s).route
        return !!r && generateEncounters(r, s, 'direct').some((e) => e.key != null && sightingKeys.has(e.key))
      })
      expect(fired).toBe(true)
    } finally {
      setExternalEncounters(null)
    }
  })

  it('includes at least one Aethelian sighting in the canon (the activated dead data)', () => {
    const keys = new Set((encountersFile.encounters ?? []).map((e) => e.key))
    expect(keys.has('aethelian.fin_whale_open_crossing')).toBe(true)
    expect(keys.has('aethelian.great_white_rudder')).toBe(true)
  })
})
