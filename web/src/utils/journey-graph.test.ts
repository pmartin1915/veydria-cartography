import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRoute, getJourneyNodes } from './journey-graph'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPATIAL_PATH = resolve(__dirname, '../../public/veydria-spatial.geojson')

interface GeoJSON {
  type: string
  features: Array<{ type: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }>
}

let geojson: GeoJSON
let graph: ReturnType<typeof buildGraph>
let nodes: ReturnType<typeof getJourneyNodes>

beforeAll(() => {
  geojson = JSON.parse(readFileSync(SPATIAL_PATH, 'utf-8'))
  graph = buildGraph(geojson as never)
  nodes = getJourneyNodes(geojson as never)
})

describe('journey-graph: Dijkstra start-node fix', () => {
  it('produces a non-null route from a port to an oasis', () => {
    const port = nodes.find(n => n.category === 'port')
    const oasis = nodes.find(n => n.category === 'oasis')
    expect(port, 'expected at least one port in the graph').toBeDefined()
    expect(oasis, 'expected at least one oasis in the graph').toBeDefined()

    const route = findRoute(graph, port!.id, oasis!.id)
    expect(route, 'route should not be null — this guards the || → ?? bug').not.toBeNull()
    expect(route!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(route!.totalKm).toBeGreaterThan(0)
  })

  it('returns a route where every hop has a finite cost', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    expect(civs.length).toBeGreaterThanOrEqual(2)
    const route = findRoute(graph, civs[0].id, civs[civs.length - 1].id)
    expect(route).not.toBeNull()
    for (const edge of route!.edges) {
      expect(edge.distanceSvg).toBeGreaterThan(0)
      expect(edge.distanceSvg).toBeLessThan(Infinity)
    }
  })

  it('start === end produces a degenerate single-node route', () => {
    const civ = nodes.find(n => n.category === 'civilization')!
    const route = findRoute(graph, civ.id, civ.id)
    expect(route).not.toBeNull()
    expect(route!.nodes.length).toBe(1)
    expect(route!.totalKm).toBe(0)
  })

  it('finds a route between every civilization pair (graph is connected)', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    let success = 0
    let attempts = 0
    for (let i = 0; i < civs.length; i++) {
      for (let j = i + 1; j < civs.length; j++) {
        attempts++
        const r = findRoute(graph, civs[i].id, civs[j].id)
        if (r) success++
      }
    }
    expect(success).toBe(attempts)
  })
})
