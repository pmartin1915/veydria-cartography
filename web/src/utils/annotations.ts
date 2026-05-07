/**
 * annotations.ts — Map annotation persistence, CRUD, and export
 *
 * Stores user-placed pins in localStorage under `veydria-annotations-v2`.
 * Coordinates are in SVG space (x, y) for stability across zoom levels.
 *
 * v2 added optional `featureId` / `featureName` for binding pins to nearby
 * world features. A one-time migration reads any v1 payload, copies it
 * forward without feature links, and removes the v1 key.
 */

const STORAGE_KEY_V1 = 'veydria-annotations-v1'
const STORAGE_KEY = 'veydria-annotations-v2'

// SVG-unit radius for "near a feature" auto-binding. The map is 1200x800;
// 40 units ≈ 100 km on the canonical 2.5 km/unit scale, which feels right
// for "I dropped a pin on the port".
export const FEATURE_LINK_MAX_DISTANCE = 40

export interface MapAnnotation {
  id: string
  x: number // SVG coordinate
  y: number // SVG coordinate
  label: string
  body: string
  color: string
  createdAt: number
  featureId?: string
  featureName?: string
}

interface FeatureLike {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

export const ANNOTATION_COLORS: { value: string; label: string }[] = [
  { value: '#c4a86b', label: 'Parchment' },
  { value: '#c06040', label: 'Rust' },
  { value: '#4a8ab0', label: 'Sea' },
  { value: '#4a9a3a', label: 'Forest' },
  { value: '#5a5a5a', label: 'Charcoal' },
]

export const DEFAULT_ANNOTATION_COLOR = '#c4a86b'

// Categories ineligible for auto-link. Terrain cells are 3000+ tiny grid
// polygons that would always win on proximity; water is a single basin
// polygon whose centroid is rarely meaningful.
const UNLINKABLE_CATEGORIES = new Set(['terrain_cell', 'water'])

export function loadAnnotations(): MapAnnotation[] {
  try {
    migrateV1ToV2()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidAnnotation)
  } catch {
    return []
  }
}

function migrateV1ToV2(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return
    const legacy = localStorage.getItem(STORAGE_KEY_V1)
    if (!legacy) return
    const parsed = JSON.parse(legacy)
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY_V1)
      return
    }
    const migrated = parsed.filter(isValidAnnotation)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    localStorage.removeItem(STORAGE_KEY_V1)
  } catch {
    // localStorage unavailable or corrupt — leave v1 in place silently
  }
}

export function saveAnnotations(annotations: MapAnnotation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations))
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

function isValidAnnotation(a: unknown): a is MapAnnotation {
  if (!a || typeof a !== 'object') return false
  const o = a as Record<string, unknown>
  if (
    typeof o.id !== 'string' || o.id.length === 0 ||
    typeof o.x !== 'number' || Number.isNaN(o.x) || !Number.isFinite(o.x) ||
    typeof o.y !== 'number' || Number.isNaN(o.y) || !Number.isFinite(o.y) ||
    typeof o.label !== 'string' ||
    typeof o.body !== 'string' ||
    typeof o.color !== 'string' ||
    typeof o.createdAt !== 'number' || Number.isNaN(o.createdAt) || !Number.isFinite(o.createdAt)
  ) return false
  if (o.featureId !== undefined && typeof o.featureId !== 'string') return false
  if (o.featureName !== undefined && typeof o.featureName !== 'string') return false
  return true
}

export function createAnnotation(
  x: number,
  y: number,
  label = 'New Pin',
  body = '',
  color = DEFAULT_ANNOTATION_COLOR
): MapAnnotation {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    x,
    y,
    label,
    body,
    color,
    createdAt: Date.now(),
  }
}

export function updateAnnotation(
  annotations: MapAnnotation[],
  id: string,
  updates: Partial<Omit<MapAnnotation, 'id' | 'createdAt'>>
): MapAnnotation[] {
  const next = annotations.map((a) =>
    a.id === id ? { ...a, ...updates } : a
  )
  saveAnnotations(next)
  return next
}

export function deleteAnnotation(
  annotations: MapAnnotation[],
  id: string
): MapAnnotation[] {
  const next = annotations.filter((a) => a.id !== id)
  saveAnnotations(next)
  return next
}

export function addAnnotation(
  annotations: MapAnnotation[],
  annotation: MapAnnotation
): MapAnnotation[] {
  const next = [...annotations, annotation]
  saveAnnotations(next)
  return next
}

function getFeatureCentroid(feature: FeatureLike): [number, number] | null {
  const explicit = feature.properties.centroid as [number, number] | undefined
  if (Array.isArray(explicit) && explicit.length === 2 &&
      typeof explicit[0] === 'number' && typeof explicit[1] === 'number') {
    return [explicit[0], explicit[1]]
  }
  const coords = feature.geometry.coordinates
  const type = feature.geometry.type
  if (type === 'Point') {
    const [x, y] = coords as number[]
    return [x, y]
  }
  if (type === 'Polygon') {
    const ring = (coords as number[][][])[0]
    if (!ring || ring.length === 0) return null
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [cx, cy]
  }
  if (type === 'LineString') {
    const pts = coords as number[][]
    if (!pts || pts.length === 0) return null
    const mid = pts[Math.floor(pts.length / 2)]
    return [mid[0], mid[1]]
  }
  return null
}

function getFeatureId(f: FeatureLike): string {
  return ((f as unknown as Record<string, unknown>).id as string) ||
    (f.properties.id as string) || ''
}

/**
 * Find the nearest named, link-eligible feature to an SVG point.
 * Returns null if no candidate falls within `maxDistance` SVG units.
 */
export function findNearestFeature(
  x: number,
  y: number,
  features: FeatureLike[],
  maxDistance: number = FEATURE_LINK_MAX_DISTANCE
): { id: string; name: string } | null {
  let bestId = ''
  let bestName = ''
  let bestDistSq = maxDistance * maxDistance

  for (const f of features) {
    const cat = (f.properties.category as string) || ''
    if (UNLINKABLE_CATEGORIES.has(cat)) continue
    const name = f.properties.name as string | undefined
    if (!name) continue
    const id = getFeatureId(f)
    if (!id) continue
    const c = getFeatureCentroid(f)
    if (!c) continue
    const dx = c[0] - x
    const dy = c[1] - y
    const distSq = dx * dx + dy * dy
    if (distSq <= bestDistSq) {
      bestDistSq = distSq
      bestId = id
      bestName = name
    }
  }

  if (!bestId) return null
  return { id: bestId, name: bestName }
}

/** Distance from a point to a line segment (SVG coords). */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  if (ab2 === 0) return Math.sqrt(apx * apx + apy * apy)
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy)
}

/** Find annotations that fall within `threshold` SVG units of any route segment. */
export function annotationsNearRoute(
  annotations: MapAnnotation[],
  routeNodes: { x: number; y: number }[],
  threshold = 40
): MapAnnotation[] {
  if (routeNodes.length < 2) return []
  return annotations.filter((a) => {
    for (let i = 1; i < routeNodes.length; i++) {
      const d = pointToSegmentDistance(
        a.x,
        a.y,
        routeNodes[i - 1].x,
        routeNodes[i - 1].y,
        routeNodes[i].x,
        routeNodes[i].y
      )
      if (d <= threshold) return true
    }
    return false
  })
}

/** Export all annotations as standalone campaign notes markdown. */
export function exportAnnotationsMarkdown(annotations: MapAnnotation[]): string {
  if (annotations.length === 0) {
    return '## Campaign Notes — Veydria\n\n_No pins yet._\n'
  }
  let md = '## Campaign Notes — Veydria\n\n'
  for (const a of annotations) {
    md += `### Pin: ${a.label}\n`
    md += `*SVG: (${Math.round(a.x)}, ${Math.round(a.y)})*\n`
    if (a.featureName) {
      md += `*Linked: ${a.featureName}*\n`
    }
    md += '\n'
    if (a.body) {
      md += `${a.body}\n`
    }
    md += '\n---\n\n'
  }
  return md.trim() + '\n'
}

/** Export annotations near a route as GM Notes markdown section. */
export function exportRouteGmNotes(
  annotations: MapAnnotation[],
  routeNodes: { x: number; y: number }[]
): string {
  const nearby = annotationsNearRoute(annotations, routeNodes, 40)
  if (nearby.length === 0) return ''
  let md = '\n### GM Notes\n\n'
  for (const a of nearby) {
    md += `**${a.label}**\n\n`
    if (a.featureName) md += `*Linked: ${a.featureName}*\n\n`
    if (a.body) md += `${a.body}\n\n`
  }
  return md
}
