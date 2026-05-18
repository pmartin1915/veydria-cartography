import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadCanon,
  loadSearchIndex,
  loadMapAnchors,
  getEntitiesArray,
  lookupEntity,
  getEntitiesByCiv,
  getEntitiesByFamily,
  getMapAnchor,
  __resetCaches,
} from './compendium-data';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('compendium-data', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    __resetCaches();
  });

  describe('loadCanon', () => {
    it('fetches and returns canon data', async () => {
      const data = {
        entities: { 'magic.system.irrah': { name: 'Irrah Qalib', schema_version: '0.1.0' } },
        meta: { entity_count: 1 },
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });

      const result = await loadCanon();
      expect(result).toEqual(data);
      expect(mockFetch).toHaveBeenCalledWith('/canon.json');
    });

    it('throws on failed fetch', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(loadCanon()).rejects.toThrow('Failed to load canon.json: 404');
    });
  });

  describe('loadSearchIndex', () => {
    it('fetches and returns search index', async () => {
      const data = { entries: [{ id: 'a', name: 'A', tokens: ['a'] }] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });

      const result = await loadSearchIndex();
      expect(result).toEqual(data);
    });

    it('returns empty index on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      const result = await loadSearchIndex();
      expect(result).toEqual({ entries: [] });
    });
  });

  describe('loadMapAnchors', () => {
    it('fetches and returns anchors', async () => {
      const data = { 'magic.system.irrah': { kind: 'magic-register', slug: 'irrah' } };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });

      const result = await loadMapAnchors();
      expect(result).toEqual(data);
    });

    it('returns empty object on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      const result = await loadMapAnchors();
      expect(result).toEqual({});
    });
  });

  describe('entity queries', () => {
    const canon = {
      entities: {
        'a.basin': { id: 'a.basin', name: 'Basin Thing', civ_scope: 'basin', family: 'magic', schema_version: '0.1.0', type: 'entity' },
        'a.irrah': { id: 'a.irrah', name: 'Irrah Thing', civ_scope: 'irrah', family: 'magic', schema_version: '0.1.0', type: 'entity' },
        'a.multi': { id: 'a.multi', name: 'Multi', civ_scope: ['basin', 'irrah'], family: 'religion', schema_version: '0.1.0', type: 'entity' },
      },
      meta: {},
    };

    it('getEntitiesArray returns all entities with ids', () => {
      const arr = getEntitiesArray(canon);
      expect(arr).toHaveLength(3);
      expect(arr[0].id).toBe('a.basin');
    });

    it('lookupEntity finds by id', () => {
      const e = lookupEntity(canon, 'a.irrah');
      expect(e?.name).toBe('Irrah Thing');
    });

    it('lookupEntity returns null for missing', () => {
      expect(lookupEntity(canon, 'missing')).toBeNull();
    });

    it('getEntitiesByCiv filters by single civ_scope', () => {
      const arr = getEntitiesByCiv(canon, 'irrah');
      expect(arr).toHaveLength(2);
      expect(arr.map((e) => e.name)).toContain('Irrah Thing');
      expect(arr.map((e) => e.name)).toContain('Multi');
    });

    it('getEntitiesByCiv filters by array civ_scope', () => {
      const arr = getEntitiesByCiv(canon, 'basin');
      expect(arr).toHaveLength(2);
    });

    it('getEntitiesByFamily filters by family', () => {
      const arr = getEntitiesByFamily(canon, 'magic');
      expect(arr).toHaveLength(2);
    });
  });

  describe('array-shaped canon (matches on-disk format)', () => {
    // extract-canon.mjs writes canon.entities as a sorted array. The earlier
    // object-shape path produced ?id=0 deep-links because Object.entries on
    // an array gave the index as the key and the spread-then-id pattern
    // overwrote the real entity.id. These tests pin the array path so that
    // regression cannot recur silently.
    const canonArray = {
      entities: [
        { id: 'a.basin', name: 'Basin Thing', civ_scope: 'basin', family: 'magic', schema_version: '0.1.0', type: 'entity' },
        { id: 'a.irrah', name: 'Irrah Thing', civ_scope: 'irrah', family: 'magic', schema_version: '0.1.0', type: 'entity' },
        { id: 'a.multi', name: 'Multi', civ_scope: ['basin', 'irrah'], family: 'religion', schema_version: '0.1.0', type: 'entity' },
      ],
      meta: {},
    };

    it('getEntitiesArray preserves real string ids (not array indices)', () => {
      const arr = getEntitiesArray(canonArray);
      expect(arr).toHaveLength(3);
      expect(arr.map((e) => e.id)).toEqual(['a.basin', 'a.irrah', 'a.multi']);
    });

    it('lookupEntity finds by real id, not by index', () => {
      expect(lookupEntity(canonArray, 'a.irrah')?.name).toBe('Irrah Thing');
      // The pre-fix code would have made `canon.entities["0"]` match the
      // first entity; with the array path, only the real id works.
      expect(lookupEntity(canonArray, '0')).toBeNull();
      expect(lookupEntity(canonArray, 'missing')).toBeNull();
    });

    it('getEntitiesByCiv and getEntitiesByFamily still work on array shape', () => {
      expect(getEntitiesByCiv(canonArray, 'basin').map((e) => e.id)).toEqual(['a.basin', 'a.multi']);
      expect(getEntitiesByFamily(canonArray, 'magic').map((e) => e.id)).toEqual(['a.basin', 'a.irrah']);
    });
  });
});
