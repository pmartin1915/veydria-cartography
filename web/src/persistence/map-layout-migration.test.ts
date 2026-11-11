import { describe, it, expect } from 'vitest'
import {
  migrateMapLayout,
  transformAnnotations,
  transformJourneys,
  transformCampaignContent,
  collectCurrentPositions,
  MAP_LAYOUT_KEY,
  ANNOTATIONS_KEY,
  JOURNEYS_KEY,
  ANNOTATIONS_BACKUP_KEY,
  JOURNEYS_BACKUP_KEY,
  type KvAdapter,
  type LayoutTransformContext,
} from './map-layout-migration'
import { MAP_LAYOUT } from '../utils/world-coords'
import { buildGraph } from '../utils/journey-graph'
import type { MapAnnotation } from '../utils/annotations'
import type { SavedJourney } from '../utils/journey-saved'
import type { GeoJSONCollection } from '../types/geojson'

// --- fixtures ---------------------------------------------------------------

function makeKv(
  seed: Record<string, string> = {},
  opts: { failSetFor?: (key: string) => boolean; dropSetFor?: (key: string) => boolean } = {},
) {
  const map = new Map<string, string>(Object.entries(seed))
  const state = { flushCount: 0, map }
  const adapter: KvAdapter = {
    getString: (k) => (map.has(k) ? map.get(k)! : null),
    setString: (k, v) => {
      if (opts.failSetFor?.(k)) throw new Error('disk full')
      if (opts.dropSetFor?.(k)) return // silently lost write
      map.set(k, v)
    },
    remove: (k) => void map.delete(k),
    keys: () => [...map.keys()],
    flush: async () => {
      state.flushCount++
    },
  }
  return { adapter, state }
}

// civA [0,0] ──route1── civB [100,0]; port_a sits off-route at [50,40].
const synthGeojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', id: 'civA',
      properties: { id: 'civA', name: 'Civ A', category: 'civilization', centroid: [0, 0] },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature', id: 'civB',
      properties: { id: 'civB', name: 'Civ B', category: 'civilization', centroid: [100, 0] },
      geometry: { type: 'Point', coordinates: [100, 0] },
    },
    {
      type: 'Feature', id: 'port_a',
      properties: { id: 'port_a', name: 'Port A', category: 'port' },
      geometry: { type: 'Point', coordinates: [50, 40] },
    },
    {
      type: 'Feature', id: 'route1',
      properties: { id: 'route1', name: 'Route 1', category: 'trade_route', endpoints: ['civA', 'civB'] },
      geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] },
    },
  ],
} as unknown as GeoJSONCollection

const graph = buildGraph(synthGeojson)

function makeCtx(april: LayoutTransformContext['april']): LayoutTransformContext {
  return {
    april,
    currentPositions: collectCurrentPositions(synthGeojson),
    graph,
  }
}

// April table: port_a was at [40,32] (moved +10,+8 to today's [50,40]); the
// civ centroids did not move.
const april: LayoutTransformContext['april'] = {
  points: { port_a: [40, 32] },
  centroids: { civA: [0, 0], civB: [100, 0] },
}

function makePin(partial: Partial<MapAnnotation> & Pick<MapAnnotation, 'id'>): MapAnnotation {
  return {
    x: 0,
    y: 0,
    label: partial.id,
    body: '',
    color: '#c4a86b',
    createdAt: 1,
    ...partial,
  }
}

function makeJourney(partial: Partial<SavedJourney> & Pick<SavedJourney, 'id' | 'nodeIds'>): SavedJourney {
  return {
    savedAt: 1,
    fromName: 'A',
    toName: 'B',
    waypoints: [],
    mode: 'direct',
    totalKm: 10,
    estimatedDays: 1,
    edgeCount: 1,
    bottlenecks: [],
    seasonalWarnings: [],
    ...partial,
  }
}

// --- transformAnnotations ----------------------------------------------------

describe('transformAnnotations', () => {
  const ctx = makeCtx(april)

  it('moves a pin whose featureId exists in both layouts', () => {
    const out = transformAnnotations(
      [makePin({ id: 'p1', featureId: 'port_a', x: 45, y: 36 })],
      ctx,
    )
    expect(out).toHaveLength(1)
    // port_a moved by (+10, +8) between April and now
    expect(out[0].x).toBeCloseTo(55)
    expect(out[0].y).toBeCloseTo(44)
    expect(out[0].needsReview).toBeUndefined()
  })

  it('flags an unlinked pin, a route-linked pin, and a removed-feature pin', () => {
    const out = transformAnnotations(
      [
        makePin({ id: 'free', x: 1, y: 2 }),
        makePin({ id: 'route', featureId: 'route1', x: 3, y: 4 }),
        makePin({ id: 'gone', featureId: 'port_gone', x: 5, y: 6 }),
      ],
      ctx,
    )
    expect(out).toHaveLength(3)
    for (const a of out) expect(a.needsReview).toBe(true)
    // positions untouched
    expect(out.map((a) => [a.x, a.y])).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('drops explored records', () => {
    const out = transformAnnotations(
      [makePin({ id: 'exp', hexLabel: 'G7', kind: 'explored' }), makePin({ id: 'keep' })],
      ctx,
    )
    expect(out.map((a) => a.id)).toEqual(['keep'])
    expect(out[0].needsReview).toBe(true)
  })
})

// --- transformJourneys --------------------------------------------------------

describe('transformJourneys', () => {
  const ctx = makeCtx(april)

  it('recomputes a resolvable journey through the current graph', () => {
    const out = transformJourneys(
      [makeJourney({ id: 'j1', nodeIds: ['civA', 'civB'], totalKm: 10, estimatedDays: 1, edgeCount: 1 })],
      ctx,
    ) as SavedJourney[]
    expect(out[0].stale).toBe(false)
    expect(out[0].totalKm).toBeCloseTo(400) // 100 svg units × 4 km/unit
    expect(out[0].edgeCount).toBe(1)
    expect(out[0].estimatedDays).toBeGreaterThan(0)
  })

  it('marks a journey with unknown node IDs stale and keeps its stops', () => {
    const j = makeJourney({ id: 'j2', nodeIds: ['civA', 'ghost_town'], totalKm: 10 })
    const out = transformJourneys([j], ctx) as SavedJourney[]
    expect(out[0].stale).toBe(true)
    expect(out[0].nodeIds).toEqual(['civA', 'ghost_town'])
    expect(out[0].totalKm).toBe(10) // stored values untouched
    expect(out[0].fromName).toBe('A')
    expect(out[0].toName).toBe('B')
  })

  it('passes non-journey entries through untouched', () => {
    expect(transformJourneys([null, 42, { id: 'x' }], ctx)).toEqual([null, 42, { id: 'x' }])
  })
})

// --- transformCampaignContent --------------------------------------------------

describe('transformCampaignContent', () => {
  it('transforms annotations and journeys, leaves other sections alone', () => {
    const ctx = makeCtx(april)
    const content = {
      annotations: [makePin({ id: 'p1', featureId: 'port_a', x: 45, y: 36 })],
      journeys: [makeJourney({ id: 'j1', nodeIds: ['civA', 'ghost'] })],
      stars: ['alpha', 'beta'],
    }
    const out = transformCampaignContent(content, ctx)
    const anns = out.annotations as MapAnnotation[]
    expect(anns[0].x).toBeCloseTo(55)
    const journeys = out.journeys as SavedJourney[]
    expect(journeys[0].stale).toBe(true)
    expect(out.stars).toEqual(['alpha', 'beta'])
  })
})

// --- migrateMapLayout ------------------------------------------------------------

describe('migrateMapLayout', () => {
  function seedData() {
    const annotations = [
      makePin({ id: 'linked', featureId: 'port_a', x: 45, y: 36, label: 'Linked' }),
      makePin({ id: 'free', x: 7, y: 8, label: 'Free' }),
      makePin({ id: 'exp', hexLabel: 'G7', kind: 'explored' }),
    ]
    const journeys = [
      makeJourney({ id: 'ok', nodeIds: ['civA', 'civB'] }),
      makeJourney({ id: 'ghost', nodeIds: ['civA', 'ghost_town'] }),
    ]
    const seed = {
      [ANNOTATIONS_KEY]: JSON.stringify(annotations),
      [JOURNEYS_KEY]: JSON.stringify(journeys),
    }
    return { seed, annotations, journeys }
  }

  it('runs the full migration: backup, move, flag, prune, recompute, marker last', async () => {
    const { seed } = seedData()
    const { adapter, state } = makeKv(seed)
    const ctx = makeCtx(april)

    const result = await migrateMapLayout(adapter, ctx)
    expect(result).toBe('migrated')

    // Backups hold the original payloads verbatim
    expect(adapter.getString(ANNOTATIONS_BACKUP_KEY)).toBe(seed[ANNOTATIONS_KEY])
    expect(adapter.getString(JOURNEYS_BACKUP_KEY)).toBe(seed[JOURNEYS_KEY])

    // Marker written, and the flush drained before it
    expect(adapter.getString(MAP_LAYOUT_KEY)).toBe(MAP_LAYOUT)
    expect(state.flushCount).toBe(1)

    const anns = JSON.parse(adapter.getString(ANNOTATIONS_KEY)!) as MapAnnotation[]
    const linked = anns.find((a) => a.id === 'linked')!
    expect(linked.x).toBeCloseTo(55)
    expect(linked.y).toBeCloseTo(44)
    expect(linked.needsReview).toBeUndefined()
    const free = anns.find((a) => a.id === 'free')!
    expect(free.needsReview).toBe(true)
    expect(anns.some((a) => a.kind === 'explored')).toBe(false)

    const journeys = JSON.parse(adapter.getString(JOURNEYS_KEY)!) as SavedJourney[]
    const ok = journeys.find((j) => j.id === 'ok')!
    expect(ok.stale).toBe(false)
    expect(ok.totalKm).toBeCloseTo(400)
    expect(ok.edgeCount).toBe(1)
    const ghost = journeys.find((j) => j.id === 'ghost')!
    expect(ghost.stale).toBe(true)
    expect(ghost.nodeIds).toEqual(['civA', 'ghost_town'])
  })

  it('normalizes legacy keys before migrating', async () => {
    const legacyAnn = [{ id: 'old1', x: 1, y: 2, label: 'Old', body: '', color: '#c4a86b', createdAt: 1 }]
    // Legacy history present with NO v1 key yet — it must convert eagerly so
    // nothing migrates lazily after this step.
    const legacyJourney = [{
      id: 'legacy-j', savedAt: 1, fromName: 'A', toName: 'B', waypoints: [],
      season: 'summer', mode: 'direct', totalKm: 5, estimatedDays: 1,
      nodeIds: ['civA', 'civB'], edgeCount: 1, bottlenecks: [], seasonalWarnings: [],
    }]
    const { adapter } = makeKv({
      'veydria-annotations-v1': JSON.stringify(legacyAnn),
      'veydria-journey-history': JSON.stringify(legacyJourney),
    })
    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('migrated')

    // v1 annotations normalized into v2 and transformed with the rest
    expect(adapter.getString('veydria-annotations-v1')).toBeNull()
    const anns = JSON.parse(adapter.getString(ANNOTATIONS_KEY)!) as MapAnnotation[]
    expect(anns.map((a) => a.id)).toContain('old1')
    expect(anns.find((a) => a.id === 'old1')?.needsReview).toBe(true)

    // the legacy key itself stays (as the lazy path always did); its content
    // now lives in v1, migrated and recomputed
    expect(adapter.getString('veydria-journey-history')).not.toBeNull()
    // legacy journeys converted eagerly into v1 before the backup was taken
    const journeys = JSON.parse(adapter.getString(JOURNEYS_KEY)!) as SavedJourney[]
    expect(journeys.map((j) => j.id)).toEqual(['legacy-j'])
    expect(journeys[0].stale).toBe(false)
    expect(journeys[0].totalKm).toBeCloseTo(400)
    const backupJourneys = JSON.parse(adapter.getString(JOURNEYS_BACKUP_KEY)!) as SavedJourney[]
    expect(backupJourneys.map((j) => j.id)).toEqual(['legacy-j'])
  })

  it('fresh profile: writes only the marker', async () => {
    const { adapter, state } = makeKv()
    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('fresh')
    expect(adapter.keys()).toEqual([MAP_LAYOUT_KEY])
    expect(adapter.getString(MAP_LAYOUT_KEY)).toBe(MAP_LAYOUT)
    expect(state.flushCount).toBe(0)
  })

  it('second run is a no-op', async () => {
    const { seed } = seedData()
    const { adapter } = makeKv(seed)
    await migrateMapLayout(adapter, makeCtx(april))
    const snapshot = new Map(adapter.keys().map((k) => [k, adapter.getString(k)]))

    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('already-migrated')
    for (const [k, v] of snapshot) expect(adapter.getString(k)).toBe(v)
  })

  it('re-run after an interrupted migration yields the same result as one clean run', async () => {
    const { seed } = seedData()

    // Clean run — the reference result
    const clean = makeKv(seed)
    await migrateMapLayout(clean.adapter, makeCtx(april))
    const reference = new Map(clean.adapter.keys().map((k) => [k, clean.adapter.getString(k)]))

    // Interrupted run: wipe the marker only (backups + migrated live data stay)
    const interrupted = makeKv(seed)
    await migrateMapLayout(interrupted.adapter, makeCtx(april))
    interrupted.adapter.remove(MAP_LAYOUT_KEY)

    const result = await migrateMapLayout(interrupted.adapter, makeCtx(april))
    expect(result).toBe('migrated')
    for (const [k, v] of reference) {
      expect(interrupted.adapter.getString(k), `key ${k}`).toBe(v)
    }
  })

  it('aborts when the backup write fails, leaving data untouched and no marker', async () => {
    const { seed } = seedData()
    const { adapter, state } = makeKv(seed, {
      failSetFor: (k) => k.endsWith('.backup-april'),
    })
    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('aborted')
    expect(adapter.getString(ANNOTATIONS_KEY)).toBe(seed[ANNOTATIONS_KEY])
    expect(adapter.getString(JOURNEYS_KEY)).toBe(seed[JOURNEYS_KEY])
    expect(adapter.getString(ANNOTATIONS_BACKUP_KEY)).toBeNull()
    expect(adapter.getString(JOURNEYS_BACKUP_KEY)).toBeNull()
    expect(adapter.getString(MAP_LAYOUT_KEY)).toBeNull()
    expect(state.flushCount).toBe(0)
  })

  it('aborts when the backup read-back does not match', async () => {
    const { seed } = seedData()
    const { adapter } = makeKv(seed, {
      dropSetFor: (k) => k === ANNOTATIONS_BACKUP_KEY,
    })
    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('aborted')
    expect(adapter.getString(ANNOTATIONS_KEY)).toBe(seed[ANNOTATIONS_KEY])
    expect(adapter.getString(JOURNEYS_KEY)).toBe(seed[JOURNEYS_KEY])
    expect(adapter.getString(MAP_LAYOUT_KEY)).toBeNull()
  })

  it('does not migrate when the marker is already present', async () => {
    const { adapter } = makeKv({ [MAP_LAYOUT_KEY]: MAP_LAYOUT, 'veydria.stars.v1': '[]' })
    const result = await migrateMapLayout(adapter, makeCtx(april))
    expect(result).toBe('already-migrated')
    expect(adapter.keys().sort()).toEqual([MAP_LAYOUT_KEY, 'veydria.stars.v1'].sort())
  })
})
