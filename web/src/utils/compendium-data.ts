import type { CanonData, CanonEntity, CanonEntityRaw, SearchIndex, MapAnchor } from '../components/compendium/types';

let canonCache: CanonData | null = null;
let searchIndexCache: SearchIndex | null = null;
let mapAnchorsCache: MapAnchor | null = null;

let canonPromise: Promise<CanonData> | null = null;
let searchIndexPromise: Promise<SearchIndex> | null = null;
let mapAnchorsPromise: Promise<MapAnchor> | null = null;

export async function loadCanon(): Promise<CanonData> {
  if (canonCache) return canonCache;
  if (canonPromise) return canonPromise;

  canonPromise = fetch('/canon.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load canon.json: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      canonCache = data;
      return data;
    });

  return canonPromise;
}

export async function loadSearchIndex(): Promise<SearchIndex> {
  if (searchIndexCache) return searchIndexCache;
  if (searchIndexPromise) return searchIndexPromise;

  searchIndexPromise = fetch('/search-index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load search-index.json: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      searchIndexCache = data;
      return data;
    })
    .catch(() => {
      // Graceful fallback: return empty search index
      return { entries: [] };
    });

  return searchIndexPromise;
}

export async function loadMapAnchors(): Promise<MapAnchor> {
  if (mapAnchorsCache) return mapAnchorsCache;
  if (mapAnchorsPromise) return mapAnchorsPromise;

  mapAnchorsPromise = fetch('/map-anchors.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load map-anchors.json: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      mapAnchorsCache = data;
      return data;
    })
    .catch(() => {
      return {};
    });

  return mapAnchorsPromise;
}

export function getEntitiesArray(canon: CanonData): CanonEntity[] {
  return Object.entries(canon.entities).map(([id, entity]) => ({ ...(entity as CanonEntityRaw), id }));
}

export function lookupEntity(canon: CanonData, id: string): CanonEntity | null {
  const raw = canon.entities[id];
  if (!raw) return null;
  return { ...(raw as CanonEntityRaw), id };
}

export function getEntitiesByCiv(canon: CanonData, civ: string): CanonEntity[] {
  return getEntitiesArray(canon).filter((e) => {
    if (!e.civ_scope) return false;
    if (Array.isArray(e.civ_scope)) return e.civ_scope.includes(civ);
    return e.civ_scope === civ;
  });
}

export function getEntitiesByFamily(canon: CanonData, family: string): CanonEntity[] {
  return getEntitiesArray(canon).filter((e) => e.family === family);
}

export function getEntitiesByType(canon: CanonData, type: string): CanonEntity[] {
  return getEntitiesArray(canon).filter((e) => e.type === type || e.entity_type === type);
}

export function getMapAnchor(id: string): Promise<{ kind: string; slug: string } | null> {
  return loadMapAnchors().then((anchors) => anchors[id] || null);
}

/** Reset internal caches — used only in tests. */
export function __resetCaches(): void {
  canonCache = null;
  searchIndexCache = null;
  mapAnchorsCache = null;
  canonPromise = null;
  searchIndexPromise = null;
  mapAnchorsPromise = null;
}
