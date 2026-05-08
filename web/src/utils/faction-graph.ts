/**
 * faction-graph.ts — Data extraction layer for the Faction Relationship Graph view.
 *
 * Builds a typed graph of civilizations (nodes) and their relationships (edges)
 * from the spatial GeoJSON plus an optional parsed YAML topology object.
 *
 * Render-side concerns (d3-force, layout, click handlers) live elsewhere; this
 * module is pure data and is fully unit-tested with hand-crafted fixtures.
 *
 * Directionality choice: hostile / allied / trade / shared_chokepoint edges are
 * treated as UNDIRECTED. We canonicalize (source, target) so a topology that
 * declares "civA hostile to civB" AND "civB hostile to civA" collapses to a
 * single edge. Vassal edges are DIRECTED (source = liege, target = vassal) and
 * therefore are NOT collapsed across reversed pairs.
 */

import type { GeoJSONCollection, GeoJSONFeature } from '../App'

// ── Public types ────────────────────────────────────────────────────────────

export interface FactionNode {
  id: string
  name: string
  /** Coarse cardinal placement string from topology (e.g. "North", "Southwest"). */
  cardinal?: string
  /** Free-text terrain label — useful as a quick biome proxy on the graph view. */
  biome?: string
  /** Free-text elevation band. */
  elevation?: string
}

export type FactionEdgeType =
  | 'trade'
  | 'hostile'
  | 'vassal'
  | 'allied'
  | 'shared_chokepoint'

export interface FactionEdge {
  source: string
  target: string
  type: FactionEdgeType
  label?: string
  weight?: number
}

export interface FactionGraph {
  nodes: FactionNode[]
  edges: FactionEdge[]
}

/**
 * Shape we accept for a parsed YAML topology. Intentionally permissive — any
 * field may be missing. The builder degrades gracefully when topology is
 * undefined or malformed: it returns nodes-only.
 */
export interface ParsedTopology {
  civilization_positions?: Record<string, unknown>
  /**
   * Optional explicit relationship block. The canonical YAML doesn't ship this
   * yet (see integration note), but the builder will read it if present.
   * Accepted shapes:
   *   relationships:
   *     - { from: "civA", to: "civB", type: "hostile", label?: string }
   *     - { source: "civA", target: "civB", type: "trade" }
   *   OR keyed by civ:
   *     relationships:
   *       civA:
   *         hostile: ["civB"]
   *         allied:  ["civC"]
   *         vassal:  ["civD"]
   */
  relationships?: unknown
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map a free-text relationship string from topology onto our edge-type union.
 * Exposed so callers (and tests) can validate normalisation behaviour without
 * round-tripping through the full builder.
 */
export function classifyEdge(
  rawType: string,
  _ctx?: unknown
): FactionEdgeType {
  const t = (rawType ?? '').toString().trim().toLowerCase()
  if (t === 'trade' || t === 'trade_route' || t.includes('trade')) return 'trade'
  if (t === 'allied' || t === 'ally' || t === 'alliance') return 'allied'
  if (t === 'vassal' || t === 'tributary' || t === 'suzerain') return 'vassal'
  if (
    t === 'shared_chokepoint' ||
    t === 'chokepoint' ||
    t === 'shared chokepoint'
  ) {
    return 'shared_chokepoint'
  }
  // Default: anything else (hostile, hostility, war, rival, ...) → hostile.
  return 'hostile'
}

/** Civilization features: spec uses `type`, real GeoJSON uses `category`. Accept either. */
function isCivilization(f: GeoJSONFeature): boolean {
  const p = f.properties ?? {}
  return p.type === 'civilization' || p.category === 'civilization'
}

function getId(f: GeoJSONFeature): string | undefined {
  const top = (f as unknown as Record<string, unknown>).id
  if (typeof top === 'string' && top) return top
  const inner = f.properties?.id
  return typeof inner === 'string' && inner ? inner : undefined
}

/** Canonical key for de-duping. Undirected types sort their endpoints; vassal preserves order. */
function edgeKey(e: FactionEdge): string {
  if (e.type === 'vassal') return `${e.type}|${e.source}->${e.target}`
  const [a, b] = [e.source, e.target].sort()
  return `${e.type}|${a}--${b}`
}

function sameCiv(a: string, b: string): boolean {
  return !!a && !!b && a === b
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a faction-relationship graph.
 *
 *   nodes  ← geojson civilization features (geojson is the source of truth for
 *            what civs exist; topology supplements with metadata)
 *   edges  ← topology.relationships (if present)
 *          + geojson trade_route features (one trade edge per endpoint pair)
 *          + geojson chokepoint features (one shared_chokepoint edge per pair
 *            of civs that border the same chokepoint)
 *
 * Edges are deduped on (sortedEndpoints, type) for undirected types. A pair
 * with both a `trade` AND a `hostile` edge keeps both — different types are
 * never collapsed.
 */
export function buildFactionGraph(
  geojson: GeoJSONCollection,
  topology?: ParsedTopology
): FactionGraph {
  // 1. Nodes from geojson. Topology metadata layered on if a matching id exists.
  const civPositions = (topology?.civilization_positions ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >

  const nodes: FactionNode[] = []
  const knownCivIds = new Set<string>()

  for (const f of geojson.features ?? []) {
    if (!isCivilization(f)) continue
    const id = getId(f)
    if (!id || knownCivIds.has(id)) continue
    knownCivIds.add(id)

    const meta = civPositions[id] ?? undefined
    const props = f.properties ?? {}
    const name =
      (typeof props.name === 'string' && props.name) ||
      (meta && typeof meta.name === 'string' && (meta.name as string)) ||
      id
    const cardinal =
      (meta && typeof meta.cardinal === 'string' && (meta.cardinal as string)) ||
      (typeof props.cardinal === 'string' ? (props.cardinal as string) : undefined)
    const biome =
      (meta && typeof meta.terrain === 'string' && (meta.terrain as string)) ||
      (typeof props.terrain === 'string' ? (props.terrain as string) : undefined)
    const elevation =
      (meta && typeof meta.elevation === 'string' && (meta.elevation as string)) ||
      (typeof props.elevation === 'string'
        ? (props.elevation as string)
        : undefined)

    nodes.push({ id, name, cardinal, biome, elevation })
  }

  // 2. Edges. We collect into a Map keyed by edgeKey for dedup; later wins on
  //    label/weight only if the existing entry has none (we keep first-seen
  //    label otherwise).
  const edges = new Map<string, FactionEdge>()
  const pushEdge = (e: FactionEdge): void => {
    if (!knownCivIds.has(e.source) || !knownCivIds.has(e.target)) return
    if (sameCiv(e.source, e.target)) return
    const key = edgeKey(e)
    const existing = edges.get(key)
    if (!existing) {
      edges.set(key, e)
      return
    }
    if (existing.label === undefined && e.label !== undefined) {
      existing.label = e.label
    }
    if (existing.weight === undefined && e.weight !== undefined) {
      existing.weight = e.weight
    }
  }

  // 2a. Topology relationships (if any). Degrade silently on bad shapes.
  if (topology?.relationships) {
    const rels = topology.relationships
    if (Array.isArray(rels)) {
      for (const r of rels) {
        if (!r || typeof r !== 'object') continue
        const rec = r as Record<string, unknown>
        const source =
          (typeof rec.source === 'string' && rec.source) ||
          (typeof rec.from === 'string' && rec.from) ||
          ''
        const target =
          (typeof rec.target === 'string' && rec.target) ||
          (typeof rec.to === 'string' && rec.to) ||
          ''
        const rawType = typeof rec.type === 'string' ? rec.type : ''
        if (!source || !target || !rawType) continue
        const label = typeof rec.label === 'string' ? rec.label : undefined
        pushEdge({ source, target, type: classifyEdge(rawType), label })
      }
    } else if (typeof rels === 'object') {
      const obj = rels as Record<string, unknown>
      for (const [civId, payload] of Object.entries(obj)) {
        if (!payload || typeof payload !== 'object') continue
        const buckets = payload as Record<string, unknown>
        for (const [rawType, list] of Object.entries(buckets)) {
          if (!Array.isArray(list)) continue
          const type = classifyEdge(rawType)
          for (const other of list) {
            if (typeof other !== 'string' || !other) continue
            pushEdge({ source: civId, target: other, type })
          }
        }
      }
    }
  }

  // 2b. Trade-route features → trade edges between each consecutive endpoint pair.
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {}
    if (p.type !== 'trade_route' && p.category !== 'trade_route') continue
    const endpoints = p.endpoints
    if (!Array.isArray(endpoints)) continue
    const civEndpoints = endpoints.filter(
      (id): id is string => typeof id === 'string' && knownCivIds.has(id)
    )
    if (civEndpoints.length < 2) continue
    const label = typeof p.name === 'string' ? p.name : undefined
    for (let i = 0; i < civEndpoints.length; i++) {
      for (let j = i + 1; j < civEndpoints.length; j++) {
        pushEdge({
          source: civEndpoints[i],
          target: civEndpoints[j],
          type: 'trade',
          label,
        })
      }
    }
  }

  // 2c. Chokepoint features → shared_chokepoint edges between every pair of
  //     civs in `properties.borders` (or `connects`, the field the real data uses).
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {}
    if (p.type !== 'chokepoint' && p.category !== 'chokepoint') continue
    const raw =
      (Array.isArray(p.borders) && p.borders) ||
      (Array.isArray(p.connects) && p.connects) ||
      []
    const civBorders = (raw as unknown[]).filter(
      (id): id is string => typeof id === 'string' && knownCivIds.has(id)
    )
    if (civBorders.length < 2) continue
    const label = typeof p.name === 'string' ? p.name : undefined
    for (let i = 0; i < civBorders.length; i++) {
      for (let j = i + 1; j < civBorders.length; j++) {
        pushEdge({
          source: civBorders[i],
          target: civBorders[j],
          type: 'shared_chokepoint',
          label,
        })
      }
    }
  }

  return { nodes, edges: Array.from(edges.values()) }
}
