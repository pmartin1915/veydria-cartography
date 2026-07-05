export interface CanonEntityRaw {
  name?: string | null;
  schema_version: string;
  type: string;
  family?: string;
  entity_type?: string;
  civ_scope?: string | string[];
  civ_pair?: string[];
  scope?: string;
  civilization?: string;
  epoch?: string;
  status?: string;
  density?: number;
  summary?: string;
  lede?: string;
  tags?: string[];
  cross_refs?: string[];
  backlinks?: string[];
  map_anchor?: {
    kind: string;
    slug: string;
  };
  body?: string;
  [key: string]: unknown;
}

export interface CanonEntity extends CanonEntityRaw {
  id: string;
}

/**
 * Canon JSON ships `entities` as an array (sorted by id) per
 * `worldbuilder/scripts/extract-canon.mjs` — each entry already carries
 * its real string `id` in the body. Earlier drafts of cartography were
 * written assuming an object map; the loader normalizes both shapes so
 * old fixtures still work.
 */
export interface CanonData {
  entities: CanonEntity[] | Record<string, CanonEntityRaw>;
  meta?: {
    generated_at?: string;
    entity_count?: number;
  };
}

export interface SearchIndexEntry {
  id: string;
  name: string;
  tokens: string[];
}

export interface SearchIndex {
  entries: SearchIndexEntry[];
}

export interface MapAnchor {
  [entityId: string]: {
    kind: string;
    slug: string;
  };
}

export type CompendiumTab = 'browse' | 'civs' | 'lenses';

export interface Lens {
  key: string;
  label: string;
  description: string;
}

export const CIVS = [
  'basin',
  'irrah',
  'kheshkai',
  'ndjadi',
  'ngaru-bon',
  'oravan',
  'qollari',
] as const;

export type CivSlug = (typeof CIVS)[number];

export const CIV_LABELS: Record<CivSlug, string> = {
  basin: 'Aethelian Basin',
  irrah: 'Irrah',
  kheshkai: 'Kheshkai',
  ndjadi: 'Ndjadi',
  'ngaru-bon': 'Ngaru-Bon',
  oravan: 'Oravan',
  qollari: 'Qollari',
};

export const SORT_KEYS = [
  { key: 'name', label: 'Name' },
  { key: 'civ', label: 'Civilization' },
  { key: 'type', label: 'Type' },
  { key: 'density', label: 'Density' },
] as const;

export const LENSES: Lens[] = [
  { key: 'calendars', label: 'Calendars', description: 'Civilizational calendar institutions and their seasonal mechanics' },
  { key: 'cross-civ', label: 'Cross-civ Relationships', description: 'Dyadic relationship matrices between civilizations' },
  { key: 'crises', label: 'Crises', description: 'Active and dormant crises with leverage windows' },
  { key: 'magic', label: 'Magic Systems', description: 'Register-based magic systems by civilization' },
  { key: 'traditions', label: 'Theological Traditions', description: 'Religious traditions and their geographic distribution' },
  { key: 'resources', label: 'Resource Governance', description: 'Resource control, trade structures, and economic institutions' },
  { key: 'institutions', label: 'Institutions', description: 'Political, economic, and social institutions' },
  { key: 'figures', label: 'Named Figures', description: 'Deities, prophets, and legendary figures' },
  { key: 'characters', label: 'Characters', description: 'Named persons across the continent — journals, envoys, and recorded lives' },
  { key: 'record-keeping', label: 'Record-Keeping & Writing', description: 'Writing media and record technologies — how each civilization commits word to material' },
  { key: 'underclass', label: 'Underclass & Poverty', description: 'The asymmetric frame — bondage, debt, and the lives lived beneath the institutions' },
  { key: 'funerary', label: 'Death & Funerary Rites', description: 'Burial, mourning, and the undecidable afterlife across the religion layer' },
];

/**
 * Human-readable name for an entity. Prefer the canon `name` (now populated
 * from each source file's H1 by extract-canon.mjs); when it is still absent,
 * slugify the id's last segment ("factions.civ.oravan" → "Oravan") rather than
 * showing the raw dotted id. Mirrors worldbuilder's compendium shared.js.
 */
export function displayName(entity: CanonEntity): string {
  if (entity.name) return entity.name;
  if (!entity.id) return 'Unnamed';
  const slug = entity.id.split('.').pop() ?? entity.id;
  return slug
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
