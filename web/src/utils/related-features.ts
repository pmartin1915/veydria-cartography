import type { GeoJSONFeature } from '../App'

export interface RelatedFeature {
  feature: GeoJSONFeature
  relation: string
  relationType: 'trade' | 'geography' | 'connection' | 'proximity'
}

function getFeatureId(f: GeoJSONFeature): string {
  return ((f as unknown as Record<string, unknown>).id as string) || (f.properties.id as string) || ''
}

function getCentroid(f: GeoJSONFeature): [number, number] | null {
  const c = f.properties.centroid as [number, number] | undefined
  if (c) return c
  const coords = f.geometry.coordinates
  const type = f.geometry.type
  if (type === 'Point') return coords as [number, number]
  if (type === 'Polygon') {
    const ring = (coords as number[][][])[0]
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [cx, cy]
  }
  if (type === 'LineString') {
    const pts = coords as number[][]
    const mid = pts[Math.floor(pts.length / 2)]
    return [mid[0], mid[1]]
  }
  return null
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
}

export function findRelatedFeatures(
  feature: GeoJSONFeature,
  allFeatures: GeoJSONFeature[]
): RelatedFeature[] {
  const related: RelatedFeature[] = []
  const props = feature.properties
  const category = (props.category as string) || 'unknown'
  const id = getFeatureId(feature)
  const centroid = getCentroid(feature)

  // Helper to avoid duplicates
  const seen = new Set<string>([id])
  const add = (f: GeoJSONFeature, relation: string, type: RelatedFeature['relationType']) => {
    const fid = getFeatureId(f)
    if (seen.has(fid)) return
    seen.add(fid)
    related.push({ feature: f, relation, relationType: type })
  }

  // 1. Trade route connections
  if (category === 'trade_route') {
    const endpoints = (props.endpoints as string[]) || []
    for (const f of allFeatures) {
      const fId = getFeatureId(f)
      const fCat = (f.properties.category as string) || ''
      if (fCat === 'civilization' && endpoints.includes(fId)) {
        add(f, 'Route endpoint', 'trade')
      }
    }
  }

  // 2. Civilization trade routes and neighbors
  if (category === 'civilization') {
    const civId = id
    for (const f of allFeatures) {
      const fCat = (f.properties.category as string) || ''
      if (fCat === 'trade_route') {
        const endpoints = (f.properties.endpoints as string[]) || []
        if (endpoints.includes(civId)) {
          const other = endpoints.find((e) => e !== civId)
          add(f, `Trade route to ${other || 'unknown'}`, 'trade')
        }
      }
      if (fCat === 'chokepoint') {
        const connects = (f.properties.connects as string[]) || []
        if (connects.includes(civId)) {
          const other = connects.find((c) => c !== civId)
          add(f, `Border chokepoint with ${other || 'unknown'}`, 'geography')
        }
      }
      if (fCat === 'port') {
        const loc = (f.properties.location as string) || ''
        if (loc.toLowerCase().includes(civId.toLowerCase().replace('_', ' ')) ||
            loc.toLowerCase().includes((props.name as string || '').toLowerCase())) {
          add(f, 'Port within territory', 'geography')
        }
      }
    }
  }

  // 3. Port / Chokepoint / Oasis / Landmark -> nearby features and connected routes
  if (['port', 'chokepoint', 'oasis', 'landmark', 'contested_site'].includes(category)) {
    for (const f of allFeatures) {
      const fCat = (f.properties.category as string) || ''
      if (fCat === 'trade_route') {
        const path = (f.properties.path_description as string) || ''
        const name = (props.name as string) || ''
        if (path.toLowerCase().includes(name.toLowerCase().split(' ')[0])) {
          add(f, 'On trade route', 'trade')
        }
      }
    }
  }

  // 4. Proximity-based (for all types, fill remaining slots)
  if (centroid) {
    const candidates: Array<{ feature: GeoJSONFeature; dist: number }> = []
    for (const f of allFeatures) {
      const fId = getFeatureId(f)
      if (fId === id) continue
      const fCat = (f.properties.category as string) || ''
      const fCentroid = getCentroid(f)
      if (!fCentroid) continue
      const dist = distance(centroid, fCentroid)
      // Skip if already added or same category (unless it's a different type within same category)
      if (seen.has(fId)) continue
      candidates.push({ feature: f, dist })
    }
    candidates.sort((a, b) => a.dist - b.dist)
    for (const { feature: f, dist } of candidates.slice(0, 6)) {
      const fCat = (f.properties.category as string) || ''
      const fName = (f.properties.name as string) || 'Unknown'
      // Skip water and terrain cells (too many, not interesting)
      if (fCat === 'water' || fCat === 'terrain_cell') continue
      const distKm = Math.round(dist * 2.5)
      add(f, `${distKm} km away`, 'proximity')
    }
  }

  return related.slice(0, 10)
}
