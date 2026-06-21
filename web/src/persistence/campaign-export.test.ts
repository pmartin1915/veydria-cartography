import { describe, it, expect, beforeEach } from 'vitest'
import { exportCampaign } from './campaign-export'
import { saveAnnotations, type MapAnnotation } from '../utils/annotations'
import { saveJourneys, type SavedJourney } from '../utils/journey-saved'
import { saveFeatureNotes } from '../utils/feature-notes'
import { setStarredIds, getStarredIds } from '../utils/feature-stars'
import { setPrepOrder, setPrepDoneIds, getPrepDoneIds } from '../utils/session-prep'
import { saveFeatureHooks } from '../utils/feature-hooks'
import { saveCustomPresets, type LayerPreset } from '../utils/layer-presets'
import { saveTimeOfDay } from '../utils/time-of-day'
import { saveHexSize } from '../utils/hex-size'
import { saveAiLoreSettings, type AiLoreSettings } from '../utils/ai-lore'

function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}
installLocalStorageStub()

beforeEach(() => {
  localStorage.clear()
})

const EXCLUDED_KEYS = [
  'veydria.aiLoreCache.v1',
  'veydria.search.recent.v1',
  'veydria.tour.completed.v1',
  'veydria.journey.tutorial.completed.v1',
  'veydria.sessionActive.v1',
]

function seedAllStores(): void {
  const annotation: MapAnnotation = {
    id: 'pin-1',
    x: 100,
    y: 200,
    label: 'Camp',
    body: 'A good spot.',
    color: '#c4a86b',
    createdAt: 1,
  }
  saveAnnotations([annotation])

  const journey: SavedJourney = {
    id: 'j-1',
    savedAt: 2,
    name: 'Test Journey',
    fromName: 'A',
    toName: 'B',
    waypoints: [],
    season: 'summer',
    mode: 'direct',
    totalKm: 100,
    estimatedDays: 4,
    nodeIds: ['n1', 'n2'],
    edgeCount: 1,
    bottlenecks: [],
    seasonalWarnings: [],
  }
  saveJourneys([journey])

  saveFeatureNotes({ 'feature-1': 'Note one' })
  setStarredIds(['star-1', 'star-2'])
  setPrepOrder(['prep-1', 'prep-2'])
  setPrepDoneIds(['done-1'])
  saveFeatureHooks({ 'hook-1': [{ text: 'Hook text', tags: ['tag'] }] })

  const preset: LayerPreset = {
    id: 'custom-1',
    name: 'Custom',
    layers: {
      terrain_cell: true,
      civilization: true,
      water: true,
      chokepoint: true,
      port: true,
      oasis: true,
      contested_site: true,
      hex_grid: false,
      trade_route: true,
      landmark: true,
      river: true,
      faction_control: false,
      terrain_cost: false,
      biome_colors: false,
      explored: false,
      marginalia: true,
    },
    opacities: {
      terrain_cell: 0.85,
      civilization: 0.15,
      water: 0.5,
      chokepoint: 1,
      port: 1,
      oasis: 1,
      contested_site: 1,
      hex_grid: 0.7,
      trade_route: 0.75,
      landmark: 1,
      river: 0.6,
      faction_control: 1,
      terrain_cost: 0.75,
      biome_colors: 1,
      explored: 1,
      marginalia: 1,
    },
  }
  saveCustomPresets([preset])

  saveTimeOfDay('night')
  saveHexSize(70)

  const aiSettings: AiLoreSettings = {
    apiKey: 'sk-SECRET-123',
    endpoint: 'https://example.com/v1/chat/completions',
    model: 'test-model',
    temperature: 0.7,
  }
  saveAiLoreSettings(aiSettings)
}

describe('exportCampaign', () => {
  it('round-trips all content and preference sections', () => {
    seedAllStores()
    const env = exportCampaign()

    expect(env.content.annotations).toHaveLength(1)
    expect(env.content.annotations).toEqual([
      {
        id: 'pin-1',
        x: 100,
        y: 200,
        label: 'Camp',
        body: 'A good spot.',
        color: '#c4a86b',
        createdAt: 1,
      },
    ])

    expect(env.content.journeys).toHaveLength(1)
    expect((env.content.journeys as SavedJourney[])[0].id).toBe('j-1')

    expect(env.content.featureNotes).toEqual({ 'feature-1': 'Note one' })
    expect(env.content.stars).toEqual(['star-1', 'star-2'])
    expect(env.content.prepOrder).toEqual(['prep-1', 'prep-2'])
    expect(env.content.prepDone).toEqual(['done-1'])
    expect(env.content.featureHooks).toEqual({ 'hook-1': [{ text: 'Hook text', tags: ['tag'] }] })
    expect((env.content.layerPresets as LayerPreset[])[0].id).toBe('custom-1')

    expect(env.preferences?.timeOfDay).toBe('night')
    expect(env.preferences?.hexSize).toBe(70)
    expect(env.preferences?.aiLoreSettings).toEqual({
      endpoint: 'https://example.com/v1/chat/completions',
      model: 'test-model',
      temperature: 0.7,
    })
  })

  it('produces the correct envelope constants', () => {
    seedAllStores()
    const env = exportCampaign()
    expect(env.schema).toBe('veydria-campaign')
    expect(env.version).toBe(1)
    expect(typeof env.savedAt).toBe('number')
    expect(typeof env.content).toBe('object')
    expect(env.content).not.toBeNull()
  })

  it('never includes the aiLoreSettings apiKey', () => {
    const aiSettings: AiLoreSettings = {
      apiKey: 'sk-SECRET-123',
      endpoint: 'https://example.com/v1/chat/completions',
      model: 'test-model',
      temperature: 0.7,
    }
    saveAiLoreSettings(aiSettings)

    const json = JSON.stringify(exportCampaign())
    expect(json).not.toContain('sk-SECRET-123')

    const env = exportCampaign()
    const section = env.preferences?.aiLoreSettings as Record<string, unknown> | undefined
    expect(section).toBeDefined()
    expect('apiKey' in (section as object)).toBe(false)
  })

  it('omits excluded keys entirely', () => {
    seedAllStores()
    const sentinels = EXCLUDED_KEYS.map((k) => ({ key: k, value: `SENTINEL-${k}` }))
    for (const { key, value } of sentinels) {
      localStorage.setItem(key, JSON.stringify(value))
    }

    const json = JSON.stringify(exportCampaign())
    for (const { value } of sentinels) {
      expect(json).not.toContain(value)
    }
  })

  it('omits empty stores and the preferences field', () => {
    const env = exportCampaign()
    expect(env.content).toEqual({})
    expect('preferences' in env).toBe(false)
  })

  it('setStarredIds enforces cap, dedupe, order and round-trips', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`)
    setStarredIds(ids)
    expect(getStarredIds().length).toBe(50)
    expect(getStarredIds()).toEqual(ids.slice(0, 50))

    localStorage.clear()
    setStarredIds(['a', 'a', 'b'])
    expect(getStarredIds()).toEqual(['a', 'b'])
  })

  it('setPrepDoneIds deduplicates while preserving order', () => {
    setPrepDoneIds(['x', 'y', 'x'])
    expect(getPrepDoneIds()).toEqual(['x', 'y'])
  })
})
