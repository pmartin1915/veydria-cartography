/**
 * faction-graph.ts — Data extraction layer for the Faction Relationship Graph view.
 *
 * Builds a graph of civilizations (nodes) and their cross-civ relationships
 * (edges) from the spatial GeoJSON plus the canonical
 * `cross_civ_relationship_matrix` entities loaded from canon.json.
 *
 * Relationships are TYPELESS and UNDIRECTED, weighted by canon `density`. The
 * factions layer (worldbuilder ADR-0019 D4) owns relationships as prose, not
 * categorical stance — so there is deliberately no hostile/allied/trade
 * colouring here. Each edge carries the canon `name`/`summary`/`lede` for the
 * on-click prose panel.
 *
 * Render-side concerns (layout, click handlers) live in FactionGraph.tsx; this
 * module is pure data and is fully unit-tested with hand-crafted fixtures.
 */

import type { GeoJSONCollection, GeoJSONFeature } from '../App'

// ── Public types ────────────────────────────────────────────────────────────

export interface FactionNode {
  id: string
  name: string
  /** True for place-as-actor nodes (e.g. the Aethelian Basin) that are not civs. */
  isPlace?: boolean
  /** Coarse cardinal placement string (e.g. "North"), when the feature carries it. */
  cardinal?: string
  /** Free-text terrain label — a quick biome proxy on the graph view. */
  biome?: string
  /** Free-text elevation band. */
  elevation?: string
}

export interface FactionEdge {
  source: string
  target: string
  /** Canon relationship density (cross-reference count); drives stroke width. */
  weight: number
  /** Canon display name, e.g. "Basin ↔ Irrah". */
  name?: string
  /** Short canon summary. */
  summary?: string
  /** Full canon lede prose (shown in the on-click panel). */
  lede?: string
  /** Canon entity id, e.g. "factions.cross_civ.basin_irrah". */
  canonId?: string
}

export interface FactionGraph {
  nodes: FactionNode[]
  edges: FactionEdge[]
}

/**
 * A canon.json `cross_civ_relationship_matrix` entity (only the fields we
 * consume). `civ_pair` is the authoritative pair of civ slugs; the entity `id`
 * string is NOT a reliable source of slugs (it is internally inconsistent).
 */
export interface CanonCrossCivEntity {
  id?: string
  entity_type?: string
  civ_pair: [string, string]
  density?: number
  name?: string
  summary?: string
  lede?: string
}

// ── Place-as-actor handling ──────────────────────────────────────────────────

/**
 * Ids that appear in canon relationships but are NOT civilizations (no
 * civilization feature in the geojson). We synthesise a node for these so their
 * edges still render. Keyed by the NORMALISED id → display name.
 */
const PLACE_NODES: Record<string, string> = {
  basin: 'Aethelian Basin',
}

/**
 * For a place node, the geojson feature whose geometry supplies its position.
 * Keyed by the NORMALISED place id → geojson feature id. Consumed by the
 * renderer (FactionGraph.tsx) to place a centroid for the synthetic node.
 */
export const PLACE_NODE_SOURCE_FEATURE: Record<string, string> = {
  basin: 'aethelian_basin',
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Normalise a canon civ slug to the geojson feature-id convention. Canon's
 * `civ_pair` uses hyphens ("ngaru-bon"); geojson civilization feature ids use
 * underscores ("ngaru_bon"). The other five civ ids match in both repos.
 */
export function normalizeCivId(slug: string): string {
  return (slug ?? '').toString().trim().toLowerCase().replace(/-/g, '_')
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

/** Canonical undirected key for de-duping a civ pair regardless of order. */
function edgeKey(source: string, target: string): string {
  return [source, target].sort().join('--')
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a faction-relationship graph.
 *
 *   nodes  ← geojson civilization features (geojson is the source of truth for
 *            what civs exist) + synthesised place nodes referenced by edges
 *   edges  ← canon cross_civ_relationship_matrix entities (typeless, weighted
 *            by `density`, carrying name/summary/lede for the prose panel)
 *
 * Degrades gracefully: with no entities (undefined / empty / junk) it returns
 * the civ nodes and no edges.
 */
export function buildFactionGraph(
  geojson: GeoJSONCollection,
  crossCivEntities?: CanonCrossCivEntity[]
): FactionGraph {
  // 1. Nodes from geojson civilization features.
  const nodes: FactionNode[] = []
  const nodeIndex = new Map<string, FactionNode>()

  for (const f of geojson.features ?? []) {
    if (!isCivilization(f)) continue
    const id = getId(f)
    if (!id || nodeIndex.has(id)) continue
    const props = f.properties ?? {}
    const node: FactionNode = {
      id,
      name: (typeof props.name === 'string' && props.name) || id,
      cardinal: typeof props.cardinal === 'string' ? props.cardinal : undefined,
      biome: typeof props.terrain === 'string' ? props.terrain : undefined,
      elevation: typeof props.elevation === 'string' ? props.elevation : undefined,
    }
    nodes.push(node)
    nodeIndex.set(id, node)
  }

  // Synthesise a place-as-actor node (e.g. basin) on first reference.
  const ensureNode = (normId: string): boolean => {
    if (nodeIndex.has(normId)) return true
    const placeName = PLACE_NODES[normId]
    if (!placeName) return false
    const placeNode: FactionNode = { id: normId, name: placeName, isPlace: true }
    nodes.push(placeNode)
    nodeIndex.set(normId, placeNode)
    return true
  }

  // 2. Edges from canon entities. Typeless, weighted by density, deduped by pair.
  const edges = new Map<string, FactionEdge>()

  for (const ent of Array.isArray(crossCivEntities) ? crossCivEntities : []) {
    if (!ent || typeof ent !== 'object') continue
    // Defensive: App pre-filters, but accept fixtures that omit entity_type.
    if (ent.entity_type && ent.entity_type !== 'cross_civ_relationship_matrix') continue
    const pair = ent.civ_pair
    if (!Array.isArray(pair) || pair.length < 2) continue
    const source = normalizeCivId(pair[0])
    const target = normalizeCivId(pair[1])
    if (!source || !target || source === target) continue
    if (!ensureNode(source) || !ensureNode(target)) continue
    const key = edgeKey(source, target)
    if (edges.has(key)) continue
    edges.set(key, {
      source,
      target,
      weight: typeof ent.density === 'number' ? ent.density : 1,
      name: typeof ent.name === 'string' ? ent.name : undefined,
      summary: typeof ent.summary === 'string' ? ent.summary : undefined,
      lede: typeof ent.lede === 'string' ? ent.lede : undefined,
      canonId: typeof ent.id === 'string' ? ent.id : undefined,
    })
  }

  return { nodes, edges: Array.from(edges.values()) }
}
