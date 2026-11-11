/**
 * map-layout-migration.ts — One-time migration of locally persisted map data
 * to the canonical `MAP_LAYOUT` ('canon-2026-09-29').
 *
 * Phase 1 moved feature geometry; pins and saved journeys stored before that
 * change carry April coordinates. This module re-anchors what it can and
 * flags the rest, in a recoverable order:
 *
 *   1. normalize legacy keys through the existing migration code
 *      (annotations v1 → v2, veydria-journey-history → veydria.journeys.v1),
 *      so nothing converts lazily after this step;
 *   2. back up the live annotations + journeys under `*.backup-april`,
 *      read the backups back and compare — on mismatch, abort with the live
 *      data untouched and no marker written;
 *   3. compute the migrated values from the BACKUP copies (never the live
 *      keys), so a re-run after an interrupted migration cannot translate a
 *      pin twice;
 *   4. write the migrated annotations + journeys, read them back to verify,
 *      and only then — after a kv flush (Tauri durability) — write the
 *      `veydria.mapLayout.v1` marker.
 *
 * Pure and testable: everything goes through an injected kv adapter plus a
 * layout-transform context (April positions, current geojson positions,
 * journey graph). App startup calls `migrateMapLayout` once, after kv
 * hydration and geojson load and before the first render that reads
 * annotations or journeys.
 */

import { MAP_LAYOUT } from '../utils/world-coords'
import {
  migrateV1ToV2,
  isValidAnnotation,
  type MapAnnotation,
} from '../utils/annotations'
import {
  migrateJourneyHistory,
  sanitizeParty,
  type SavedJourney,
} from '../utils/journey-saved'
import { findMultiStopRoute, buildGraph, type Graph } from '../utils/journey-graph'
import type { GeoJSONCollection } from '../types/geojson'
import aprilLayoutPositions from '../generated/layout-april-positions.json'

export const MAP_LAYOUT_KEY = 'veydria.mapLayout.v1'
export const ANNOTATIONS_KEY = 'veydria-annotations-v2'
export const JOURNEYS_KEY = 'veydria.journeys.v1'
export const ANNOTATIONS_BACKUP_KEY = 'veydria-annotations-v2.backup-april'
export const JOURNEYS_BACKUP_KEY = 'veydria.journeys.v1.backup-april'

/** Minimal synchronous key-value adapter (kvStore satisfies this). */
export interface KvAdapter {
  getString(key: string): string | null
  setString(key: string, value: string): void
  remove(key: string): void
  keys(): string[]
  /** Drain buffered writes to durable storage; rejects if a write failed. */
  flush(): Promise<void>
}

/** Shape of web/src/generated/layout-april-positions.json. */
export interface AprilLayoutPositions {
  points: Record<string, [number, number]>
  centroids: Record<string, [number, number]>
}

/** Inputs needed to translate persisted data onto the current layout. */
export interface LayoutTransformContext {
  april: AprilLayoutPositions
  /** featureId → current [x, y] for point features and polygon centroids. */
  currentPositions: Record<string, [number, number]>
  graph: Graph
}

export type MigrationResult =
  | 'migrated'      // ran the full migration and wrote the marker
  | 'fresh'         // no kv data at all — only the marker was written
  | 'already-migrated' // marker present — nothing to do
  | 'aborted'       // backup/verify failure — data untouched, no marker

/**
 * April anchor position for a feature: point features first, then
 * civilization/water centroids. Routes and rivers were never captured, so
 * pins linked to them have no anchor and stay flagged for review.
 */
function aprilPosition(
  april: AprilLayoutPositions,
  featureId: string,
): [number, number] | undefined {
  return april.points[featureId] ?? april.centroids[featureId]
}

/**
 * Translate one annotation list onto the current layout. A pin whose
 * `featureId` exists in BOTH the April table and the current geojson moves by
 * (current − April); every other pin keeps its coordinates and gets
 * `needsReview: true`. `explored` records are dropped (they are hex-keyed
 * bookkeeping and regenerate on demand; their copy stays in the backup).
 */
export function transformAnnotations(
  annotations: MapAnnotation[],
  ctx: LayoutTransformContext,
): MapAnnotation[] {
  const out: MapAnnotation[] = []
  for (const a of annotations) {
    if (a.kind === 'explored') continue
    const april = a.featureId ? aprilPosition(ctx.april, a.featureId) : undefined
    const current = a.featureId && april ? ctx.currentPositions[a.featureId] : undefined
    if (april && current) {
      out.push({
        ...a,
        x: a.x + (current[0] - april[0]),
        y: a.y + (current[1] - april[1]),
      })
    } else {
      out.push({ ...a, needsReview: true })
    }
  }
  return out
}

/**
 * Recompute each saved journey through the current graph, mirroring the
 * planner's own restore path (findMultiStopRoute over the stored node IDs).
 * A journey whose node IDs no longer resolve keeps its stops and gets
 * `stale: true` (the list shows "Route needs replanning"). Entries that do
 * not look like journeys pass through untouched.
 */
export function transformJourneys(
  journeys: unknown[],
  ctx: LayoutTransformContext,
): unknown[] {
  return journeys.map((j) => {
    if (!j || typeof j !== 'object') return j
    const entry = j as SavedJourney
    if (!Array.isArray(entry.nodeIds) || entry.nodeIds.length < 2) return j
    if (!entry.nodeIds.every((n): n is string => typeof n === 'string')) return j
    const route = findMultiStopRoute(
      ctx.graph,
      entry.nodeIds,
      entry.season,
      entry.mode,
      sanitizeParty(entry.party),
    )
    if (!route) {
      return { ...entry, stale: true }
    }
    return {
      ...entry,
      stale: false,
      totalKm: route.totalKm,
      estimatedDays: route.estimatedDays,
      edgeCount: route.edges.length,
      bottlenecks: route.bottlenecks,
    }
  })
}

/**
 * Apply the step-1 transform to campaign-envelope content (annotations +
 * journeys sections). Used by the v1 → v2 campaign-import upgrade so an old
 * campaign file lands on the current layout before it is saved.
 */
export function transformCampaignContent(
  content: Record<string, unknown>,
  ctx: LayoutTransformContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...content }
  if (Array.isArray(out.annotations)) {
    const annotations = (out.annotations as unknown[]).filter(isValidAnnotation)
    out.annotations = transformAnnotations(annotations, ctx)
  }
  if (Array.isArray(out.journeys)) {
    out.journeys = transformJourneys(out.journeys as unknown[], ctx)
  }
  return out
}

/**
 * Compute the current-layout position table from the loaded geojson: point
 * features contribute their coordinates; civilization/water polygons their
 * explicit `centroid` property, else the vertex mean of the outer ring
 * (matching how the April table was captured). Routes/rivers/lines are not
 * re-anchored and contribute nothing.
 */
export function collectCurrentPositions(
  geojson: GeoJSONCollection,
): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  const put = (id: string, pos: [number, number] | null) => {
    if (id && pos) out[id] = pos
  }
  for (const f of geojson.features) {
    const id = (
      (f.properties.route_id as string) ||
      ((f as unknown as Record<string, unknown>).id as string) ||
      (f.properties.id as string) ||
      ''
    )
    if (!id) continue
    const coords = f.geometry.coordinates
    if (f.geometry.type === 'Point') {
      const [x, y] = coords as number[]
      put(id, [x, y] as [number, number])
    } else if (f.geometry.type === 'Polygon') {
      const explicit = f.properties.centroid as [number, number] | undefined
      if (
        Array.isArray(explicit) && explicit.length === 2 &&
        typeof explicit[0] === 'number' && typeof explicit[1] === 'number'
      ) {
        put(id, [explicit[0], explicit[1]] as [number, number])
        continue
      }
      const ring = (coords as number[][][])[0]
      if (!ring || ring.length === 0) continue
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
      put(id, [cx, cy] as [number, number])
    } else if (f.geometry.type === 'MultiPolygon') {
      const explicit = f.properties.centroid as [number, number] | undefined
      if (
        Array.isArray(explicit) && explicit.length === 2 &&
        typeof explicit[0] === 'number' && typeof explicit[1] === 'number'
      ) {
        put(id, [explicit[0], explicit[1]] as [number, number])
        continue
      }
      let cx = 0, cy = 0, n = 0
      for (const poly of coords as unknown as number[][][][]) {
        for (const p of poly[0]) { cx += p[0]; cy += p[1]; n++ }
      }
      if (n > 0) put(id, [cx / n, cy / n] as [number, number])
    }
  }
  return out
}

/**
 * Build a layout-transform context from a loaded geojson. Convenience for
 * call sites that have the geojson but not a prebuilt graph (campaign v1
 * import); App startup builds its context inline from the same geojson.
 */
export function buildLayoutContext(geojson: GeoJSONCollection): LayoutTransformContext {
  return {
    april: {
      points: aprilLayoutPositions.points as unknown as Record<string, [number, number]>,
      centroids: aprilLayoutPositions.centroids as unknown as Record<string, [number, number]>,
    },
    currentPositions: collectCurrentPositions(geojson),
    graph: buildGraph(geojson),
  }
}

function parseAnnotations(raw: string): MapAnnotation[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidAnnotation)
  } catch {
    return []
  }
}

function parseJourneys(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Write `backupKey` from `source` if no backup exists yet, then read it back
 * and compare. Returns false on any write/read/verify failure (the corrupt
 * backup is removed so a later run starts clean); true otherwise. A null
 * source means there is nothing to back up.
 */
function backupAndVerify(
  kv: KvAdapter,
  backupKey: string,
  source: string | null,
): boolean {
  try {
    if (source === null) return true
    if (kv.getString(backupKey) !== null) return true
    kv.setString(backupKey, source)
    if (kv.getString(backupKey) !== source) {
      kv.remove(backupKey)
      return false
    }
    return true
  } catch {
    try { kv.remove(backupKey) } catch { /* best effort */ }
    return false
  }
}

/**
 * Run the one-time local layout migration. Guarded by `veydria.mapLayout.v1`:
 * marker present → no-op; no kv data at all → only the marker is written.
 * Otherwise normalize → back up → compute from backups → write → verify →
 * flush → marker last. Never throws: a failure aborts with live data
 * untouched and the marker absent, so the next boot re-runs it.
 */
export async function migrateMapLayout(
  kv: KvAdapter,
  ctx: LayoutTransformContext,
): Promise<MigrationResult> {
  try {
    if (kv.getString(MAP_LAYOUT_KEY) !== null) return 'already-migrated'

    const hasData = kv.keys().some((k) => k !== MAP_LAYOUT_KEY)
    if (!hasData) {
      kv.setString(MAP_LAYOUT_KEY, MAP_LAYOUT)
      return 'fresh'
    }

    // 1. Normalize legacy keys through the existing migration code so nothing
    //    converts lazily after this step.
    migrateV1ToV2(kv)
    migrateJourneyHistory(kv)

    // 2. Back up the live data, read back, compare. Abort leaves everything
    //    untouched (backups are additive and equal to the pre-migration live
    //    values, so they are safe to keep).
    if (!backupAndVerify(kv, ANNOTATIONS_BACKUP_KEY, kv.getString(ANNOTATIONS_KEY))) {
      return 'aborted'
    }
    if (!backupAndVerify(kv, JOURNEYS_BACKUP_KEY, kv.getString(JOURNEYS_KEY))) {
      return 'aborted'
    }

    // 3. Compute from the BACKUP copies, never the live keys — a re-run after
    //    an interrupted migration must not translate a pin twice.
    const annotationsRaw = kv.getString(ANNOTATIONS_BACKUP_KEY)
    const journeysRaw = kv.getString(JOURNEYS_BACKUP_KEY)
    const migratedAnnotations = annotationsRaw !== null
      ? transformAnnotations(parseAnnotations(annotationsRaw), ctx)
      : null
    const migratedJourneys = journeysRaw !== null
      ? transformJourneys(parseJourneys(journeysRaw), ctx)
      : null

    // 4. Write the migrated values and read them back to verify before the
    //    marker goes down. A failed verify aborts; the backups still hold the
    //    original data, so the next run recomputes the same result.
    if (migratedAnnotations !== null) {
      const json = JSON.stringify(migratedAnnotations)
      kv.setString(ANNOTATIONS_KEY, json)
      if (kv.getString(ANNOTATIONS_KEY) !== json) return 'aborted'
    }
    if (migratedJourneys !== null) {
      const json = JSON.stringify(migratedJourneys)
      kv.setString(JOURNEYS_KEY, json)
      if (kv.getString(JOURNEYS_KEY) !== json) return 'aborted'
    }

    // 5. Tauri persists fire-and-forget through a buffered cache — drain it
    //    before the marker makes the migration irreversible on next boot.
    await kv.flush()

    // 6. Marker last.
    kv.setString(MAP_LAYOUT_KEY, MAP_LAYOUT)
    return 'migrated'
  } catch {
    return 'aborted'
  }
}
