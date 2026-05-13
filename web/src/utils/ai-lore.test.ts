import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadAiLoreSettings,
  saveAiLoreSettings,
  getCachedLore,
  setCachedLore,
  clearAiLoreCache,
  generateMockLore,
  fetchAiLore,
  buildPrompt,
  type AiLoreType,
} from './ai-lore'
import type { GeoJSONFeature } from '../App'

// Minimal in-memory localStorage for the node test environment.
function installLocalStorageStub() {
  const store: Record<string, string> = {}
  const stub = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k in store) delete store[k] },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
}
installLocalStorageStub()

const mockFeature = (overrides?: Partial<GeoJSONFeature['properties']>): GeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: {
    id: 'test_feature',
    name: 'Test Port',
    category: 'port',
    description: 'A test port for testing',
    ...overrides,
  },
})

describe('ai-lore settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing is stored', () => {
    const s = loadAiLoreSettings()
    expect(s.apiKey).toBeNull()
    expect(s.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(s.model).toBe('gpt-4o-mini')
  })

  it('round-trips custom settings', () => {
    const settings = { apiKey: 'sk-test', endpoint: 'https://example.com/v1/chat/completions', model: 'gpt-4' }
    saveAiLoreSettings(settings)
    const loaded = loadAiLoreSettings()
    expect(loaded).toEqual(settings)
  })

  it('merges partial stored settings with defaults', () => {
    localStorage.setItem('veydria.aiLoreSettings.v1', JSON.stringify({ model: 'custom-model' }))
    const s = loadAiLoreSettings()
    expect(s.apiKey).toBeNull()
    expect(s.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(s.model).toBe('custom-model')
  })
})

describe('ai-lore cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null for uncached lore', () => {
    expect(getCachedLore('missing', 'rumors')).toBeNull()
  })

  it('stores and retrieves lore', () => {
    setCachedLore('feat1', 'rumors', 'Some rumor text')
    expect(getCachedLore('feat1', 'rumors')).toBe('Some rumor text')
    expect(getCachedLore('feat1', 'npcs')).toBeNull()
  })

  it('stores multiple types for the same feature', () => {
    setCachedLore('feat1', 'rumors', 'R1')
    setCachedLore('feat1', 'npcs', 'N1')
    setCachedLore('feat1', 'tensions', 'T1')
    expect(getCachedLore('feat1', 'rumors')).toBe('R1')
    expect(getCachedLore('feat1', 'npcs')).toBe('N1')
    expect(getCachedLore('feat1', 'tensions')).toBe('T1')
  })

  it('clears cache entirely', () => {
    setCachedLore('feat1', 'rumors', 'R1')
    clearAiLoreCache()
    expect(getCachedLore('feat1', 'rumors')).toBeNull()
  })
})

describe('mock lore generator', () => {
  it('generates deterministic content for the same feature + type', () => {
    const f = mockFeature()
    const a = generateMockLore(f, 'rumors')
    const b = generateMockLore(f, 'rumors')
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(50)
  })

  it('generates different content for different types', () => {
    const f = mockFeature()
    const rumors = generateMockLore(f, 'rumors')
    const npcs = generateMockLore(f, 'npcs')
    const tensions = generateMockLore(f, 'tensions')
    expect(rumors).not.toBe(npcs)
    expect(npcs).not.toBe(tensions)
  })

  it('generates different content for different features', () => {
    const f1 = mockFeature({ id: 'port_a', name: 'Port A' })
    const f2 = mockFeature({ id: 'port_b', name: 'Port B' })
    const a = generateMockLore(f1, 'rumors')
    const b = generateMockLore(f2, 'rumors')
    expect(a).not.toBe(b)
  })

  it('substitutes feature name into templates', () => {
    const f = mockFeature({ name: 'Ki-Mbuhari' })
    const content = generateMockLore(f, 'rumors')
    expect(content).toContain('Ki-Mbuhari')
  })

  it('produces 3 numbered entries', () => {
    const f = mockFeature()
    const content = generateMockLore(f, 'rumors')
    expect(content).toMatch(/1\./)
    expect(content).toMatch(/2\./)
    expect(content).toMatch(/3\./)
  })

  it('falls back to default templates for unknown categories', () => {
    const f = mockFeature({ category: 'weird_unknown' })
    const content = generateMockLore(f, 'rumors')
    expect(content.length).toBeGreaterThan(50)
    expect(content).toContain('Test Port')
  })

  const categories: Array<{ cat: string; types: AiLoreType[] }> = [
    { cat: 'port', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'chokepoint', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'oasis', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'civilization', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'trade_route', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'water', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'landmark', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'river', types: ['rumors', 'npcs', 'tensions'] },
    { cat: 'contested_site', types: ['rumors', 'npcs', 'tensions'] },
  ]

  categories.forEach(({ cat, types }) => {
    types.forEach((type) => {
      it(`generates content for ${cat} / ${type}`, () => {
        const f = mockFeature({ category: cat, name: 'Test Place' })
        const content = generateMockLore(f, type)
        expect(content.length).toBeGreaterThan(50)
        // NPC templates sometimes don't include the name placeholder
        if (type !== 'npcs') {
          expect(content).toContain('Test Place')
        }
      })
    })
  })
})

describe('buildPrompt', () => {
  it('includes feature name and category', () => {
    const f = mockFeature({ name: 'Ki-Mbuhari', category: 'port' })
    const prompt = buildPrompt(f, 'rumors')
    expect(prompt).toContain('Ki-Mbuhari')
    expect(prompt).toContain('Category: port')
    expect(prompt).toContain('rumours')
  })

  it('includes world context for all types', () => {
    const f = mockFeature()
    const rumors = buildPrompt(f, 'rumors')
    const npcs = buildPrompt(f, 'npcs')
    const tensions = buildPrompt(f, 'tensions')
    expect(rumors).toContain('Veydria')
    expect(npcs).toContain('Veydria')
    expect(tensions).toContain('Veydria')
  })

  it('uses type-specific instructions', () => {
    const f = mockFeature()
    expect(buildPrompt(f, 'rumors')).toContain('rumours')
    expect(buildPrompt(f, 'npcs')).toContain('NPCs')
    expect(buildPrompt(f, 'tensions')).toContain('tensions')
  })

  it('requests plain text without markdown', () => {
    const f = mockFeature()
    const prompt = buildPrompt(f, 'rumors')
    expect(prompt).toContain('No markdown formatting')
  })
})

describe('fetchAiLore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns cached content without calling API', async () => {
    setCachedLore('test_feature', 'rumors', 'Cached rumor')
    const f = mockFeature()
    const result = await fetchAiLore(f, 'rumors', { apiKey: null, endpoint: '', model: '' })
    expect(result.content).toBe('Cached rumor')
    expect(result.cached).toBe(true)
  })

  it('falls back to mock when no API key is set', async () => {
    const f = mockFeature()
    const result = await fetchAiLore(f, 'rumors', { apiKey: null, endpoint: '', model: '' })
    expect(result.cached).toBe(false)
    expect(result.content.length).toBeGreaterThan(50)
    // Should have cached the mock result
    expect(getCachedLore('test_feature', 'rumors')).toBe(result.content)
  })

  it('calls the API when API key is provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  API-generated rumor  ' } }] }),
    } as Response)

    const f = mockFeature()
    const result = await fetchAiLore(f, 'rumors', {
      apiKey: 'sk-test',
      endpoint: 'https://api.example.com/v1/chat/completions',
      model: 'gpt-test',
    })

    expect(result.content).toBe('API-generated rumor')
    expect(result.cached).toBe(false)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('https://api.example.com/v1/chat/completions')
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe('gpt-test')
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('Test Port')
  })

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response)

    const f = mockFeature()
    await expect(
      fetchAiLore(f, 'rumors', { apiKey: 'sk-test', endpoint: 'https://api.example.com/v1/chat/completions', model: 'gpt-test' })
    ).rejects.toThrow('AI lore request failed (429)')
  })

  it('throws on empty API response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    } as Response)

    const f = mockFeature()
    await expect(
      fetchAiLore(f, 'rumors', { apiKey: 'sk-test', endpoint: 'https://api.example.com/v1/chat/completions', model: 'gpt-test' })
    ).rejects.toThrow('AI lore returned empty content')
  })
})
