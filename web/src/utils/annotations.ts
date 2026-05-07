/**
 * annotations.ts — Map annotation persistence, CRUD, and export
 *
 * Stores user-placed pins in localStorage under `veydria-annotations-v1`.
 * Coordinates are in SVG space (x, y) for stability across zoom levels.
 */

const STORAGE_KEY = 'veydria-annotations-v1'

export interface MapAnnotation {
  id: string
  x: number // SVG coordinate
  y: number // SVG coordinate
  label: string
  body: string
  color: string
  createdAt: number
}

export const ANNOTATION_COLORS: { value: string; label: string }[] = [
  { value: '#c4a86b', label: 'Parchment' },
  { value: '#c06040', label: 'Rust' },
  { value: '#4a8ab0', label: 'Sea' },
  { value: '#4a9a3a', label: 'Forest' },
  { value: '#5a5a5a', label: 'Charcoal' },
]

export const DEFAULT_ANNOTATION_COLOR = '#c4a86b'

export function loadAnnotations(): MapAnnotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidAnnotation)
  } catch {
    return []
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
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.x === 'number' && !Number.isNaN(o.x) && Number.isFinite(o.x) &&
    typeof o.y === 'number' && !Number.isNaN(o.y) && Number.isFinite(o.y) &&
    typeof o.label === 'string' &&
    typeof o.body === 'string' &&
    typeof o.color === 'string' &&
    typeof o.createdAt === 'number' && !Number.isNaN(o.createdAt) && Number.isFinite(o.createdAt)
  )
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
    md += `*SVG: (${Math.round(a.x)}, ${Math.round(a.y)})*\n\n`
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
    if (a.body) md += `${a.body}\n\n`
  }
  return md
}
