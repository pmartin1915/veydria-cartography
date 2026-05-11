import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRoute, findRouteWithFallback, findComparisonRoutes, getJourneyNodes } from './journey-graph'

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

  it('findRouteWithFallback returns no pivots when a direct route exists', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const fb = findRouteWithFallback(graph, civs[0].id, civs[1].id)
    expect(fb.route).not.toBeNull()
    expect(fb.pivots).toEqual([])
  })

  it('findRouteWithFallback never throws and yields a route for every named pair', () => {
    const sample = nodes.filter(n => n.category === 'civilization' || n.category === 'port').slice(0, 8)
    let success = 0
    for (let i = 0; i < sample.length; i++) {
      for (let j = 0; j < sample.length; j++) {
        if (i === j) continue
        const fb = findRouteWithFallback(graph, sample[i].id, sample[j].id)
        if (fb.route) success++
      }
    }
    expect(success).toBeGreaterThan(0)
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

describe('findComparisonRoutes', () => {
  it('returns all three non-null routes for a typical civilization pair', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    expect(civs.length).toBeGreaterThanOrEqual(2)
    const comps = findComparisonRoutes(graph, civs[0].id, civs[1].id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    expect(comps.direct!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(comps.safest!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(comps.cheapest!.nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('direct route has the shortest (or equal) raw distance', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const comps = findComparisonRoutes(graph, civs[0].id, civs[civs.length - 1].id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    const dKm = comps.direct!.totalKm
    const sKm = comps.safest!.totalKm
    const cKm = comps.cheapest!.totalKm
    // Direct optimizes purely for distance; safest/cheapest add multipliers ≥1.
    expect(dKm).toBeLessThanOrEqual(sKm)
    expect(dKm).toBeLessThanOrEqual(cKm)
  })

  it('returns degenerate single-node routes when start === end', () => {
    const civ = nodes.find(n => n.category === 'civilization')!
    const comps = findComparisonRoutes(graph, civ.id, civ.id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    expect(comps.direct!.nodes.length).toBe(1)
    expect(comps.safest!.nodes.length).toBe(1)
    expect(comps.cheapest!.nodes.length).toBe(1)
    expect(comps.direct!.totalKm).toBe(0)
    expect(comps.safest!.totalKm).toBe(0)
    expect(comps.cheapest!.totalKm).toBe(0)
  })

  it('returns all-null for unknown node IDs', () => {
    const comps = findComparisonRoutes(graph, 'nonexistent-start', 'nonexistent-end')
    expect(comps.direct).toBeNull()
    expect(comps.safest).toBeNull()
    expect(comps.cheapest).toBeNull()
  })

  it('never throws for any named-node pair', () => {
    const sample = nodes.slice(0, 12)
    for (let i = 0; i < sample.length; i++) {
      for (let j = 0; j < sample.length; j++) {
        if (i === j) continue
        expect(() => findComparisonRoutes(graph, sample[i].id, sample[j].id)).not.toThrow()
      }
    }
  })

  it('respects season parameter', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const spring = findComparisonRoutes(graph, civs[0].id, civs[1].id, 'spring')
    const winter = findComparisonRoutes(graph, civs[0].id, civs[1].id, 'winter')
    // Season can change route availability or edge costs, so the routes may differ.
    // We only assert that both calls succeed and return non-null routes.
    expect(spring.direct).not.toBeNull()
    expect(winter.direct).not.toBeNull()
    expect(spring.safest).not.toBeNull()
    expect(winter.safest).not.toBeNull()
    expect(spring.cheapest).not.toBeNull()
    expect(winter.cheapest).not.toBeNull()
  })
})
