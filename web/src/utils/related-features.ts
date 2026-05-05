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

function distanceSq(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

const PROXIMITY_MAX_DIST_SQ = 250 * 250 // 250 SVG units ≈ 625 km
const PROXIMITY_MAX_RESULTS = 6
const RELATED_MAX_TOTAL = 10

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
        const civNameLower = (props.name as string || '').toLowerCase()
        if (loc.toLowerCase().includes(civId.toLowerCase().replaceAll('_', ' ')) ||
            loc.toLowerCase().includes(civNameLower)) {
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

  // 4. Proximity-based — only scan if we have room and a centroid
  if (centroid && related.length < RELATED_MAX_TOTAL) {
    // Pre-filter to interesting categories and compute distances
    const candidates: Array<{ feature: GeoJSONFeature; distSq: number }> = []
    for (const f of allFeatures) {
      const fId = getFeatureId(f)
      if (fId === id || seen.has(fId)) continue

      const fCat = (f.properties.category as string) || ''
      if (fCat === 'water' || fCat === 'terrain_cell') continue

      const fCentroid = getCentroid(f)
      if (!fCentroid) continue

      const distSq = distanceSq(centroid, fCentroid)
      if (distSq > PROXIMITY_MAX_DIST_SQ) continue

      candidates.push({ feature: f, distSq })
    }

    // Partial sort: only need the closest N
    candidates.sort((a, b) => a.distSq - b.distSq)
    const kmPerSvgUnit = 2.5
    for (const { feature: f, distSq } of candidates.slice(0, PROXIMITY_MAX_RESULTS)) {
      const distKm = Math.round(Math.sqrt(distSq) * kmPerSvgUnit)
      add(f, `${distKm} km away`, 'proximity')
      if (related.length >= RELATED_MAX_TOTAL) break
    }
  }

  return related
}
