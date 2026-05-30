import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRoute, getJourneyNodes, DEFAULT_PARTY, type JourneyRoute, type JourneyNode } from './journey-graph'
import { DEFAULT_SUPPLY } from './journey-supply'
import { generateEncounters } from './encounters'
import type { MapAnnotation } from './annotations'
import { buildRouteMarkdown, type BuildRouteMarkdownOptions } from './journey-export'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPATIAL_PATH = resolve(__dirname, '../../public/veydria-spatial.geojson')

interface GeoJSON {
  type: string
  features: Array<{ type: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }>
}

let route: JourneyRoute
let nodes: JourneyNode[]

beforeAll(() => {
  const geojson: GeoJSON = JSON.parse(readFileSync(SPATIAL_PATH, 'utf-8'))
  const graph = buildGraph(geojson as never)
  nodes = getJourneyNodes(geojson as never)
  const civs = nodes.filter(n => n.category === 'civilization')
  const r = findRoute(graph, civs[0].id, civs[civs.length - 1].id)
  if (!r) throw new Error('test fixture: expected a civ→civ route')
  route = r
})

// A GM pin sitting exactly on the first route node → forces a "GM Notes" section
// (annotationsNearRoute uses a 40-unit radius). Gives a deterministic strip target.
function gmPin(): MapAnnotation {
  return {
    id: 'test-pin',
    x: route.nodes[0].x,
    y: route.nodes[0].y,
    label: 'Ambush Cache',
    body: 'Bandits wait here on a failed Stealth check.',
    color: '#c4a862',
    createdAt: 0,
  }
}

function opts(playerSafe: boolean): BuildRouteMarkdownOptions {
  return {
    route,
    mode: 'direct',
    party: DEFAULT_PARTY,
    supply: DEFAULT_SUPPLY,
    annotations: [gmPin()],
    sourceUrl: 'https://example.test/',
    playerSafe,
  }
}

describe('buildRouteMarkdown: shared structure', () => {
  it('both GM and player exports keep the route and day-by-day facts', () => {
    const gm = buildRouteMarkdown(opts(false))
    const player = buildRouteMarkdown(opts(true))
    for (const md of [gm, player]) {
      expect(md).toContain('## Journey:')
      expect(md).toContain('### Route')
      expect(md).toContain('### Day-by-Day')
      expect(md).toContain('Exported from')
    }
  })

  it('preserves route bottlenecks/seasonal warnings for players (factual route info)', () => {
    const player = buildRouteMarkdown(opts(true))
    const factual = [...route.bottlenecks, ...route.seasonalWarnings]
    if (factual.length > 0) {
      expect(player).toContain('### Warnings')
      for (const w of factual) expect(player).toContain(w)
    }
  })
})

describe('buildRouteMarkdown: player-safe strips GM-only content', () => {
  it('drops the GM Notes section', () => {
    const gm = buildRouteMarkdown(opts(false))
    const player = buildRouteMarkdown(opts(true))
    // Positive proof the strip does work: GM has it, player does not.
    expect(gm).toContain('### GM Notes')
    expect(gm).toContain('Ambush Cache')
    expect(gm).toContain('Bandits wait here')
    expect(player).not.toContain('### GM Notes')
    expect(player).not.toContain('Ambush Cache')
    expect(player).not.toContain('Bandits wait here')
  })

  it('drops the encounters section and per-day encounter beats', () => {
    const player = buildRouteMarkdown(opts(true))
    expect(player).not.toContain('### Encounters')

    const encounters = generateEncounters(route, undefined, 'direct', undefined)
    if (encounters.length > 0) {
      const gm = buildRouteMarkdown(opts(false))
      expect(gm).toContain('### Encounters')
      // Encounter beats must not appear anywhere (including the day-by-day list).
      for (const enc of encounters) {
        expect(player).not.toContain(enc.beat)
      }
    }
  })

  it('produces a strictly smaller document than the GM export', () => {
    const gm = buildRouteMarkdown(opts(false))
    const player = buildRouteMarkdown(opts(true))
    expect(player.length).toBeLessThan(gm.length)
  })
})
