import { describe, it, expect, beforeEach } from 'vitest'
import { importCampaign } from './campaign-import'
import { exportCampaign } from './campaign-export'
import type { CampaignEnvelope } from './campaign-schema'
import { saveAnnotations, loadAnnotations, type MapAnnotation } from '../utils/annotations'
import { saveJourneys, loadSavedJourneys, type SavedJourney } from '../utils/journey-saved'
import { saveFeatureNotes, loadFeatureNotes } from '../utils/feature-notes'
import { setStarredIds, getStarredIds } from '../utils/feature-stars'
import { setPrepOrder, getPrepOrder, setPrepDoneIds, getPrepDoneIds } from '../utils/session-prep'
import { saveFeatureHooks, loadFeatureHooks } from '../utils/feature-hooks'
import { saveCustomPresets, loadCustomPresets, type LayerPreset } from '../utils/layer-presets'
import { saveTimeOfDay, loadTimeOfDay } from '../utils/time-of-day'
import { saveHexSize, loadHexSize } from '../utils/hex-size'
import { saveAiLoreSettings, loadAiLoreSettings, type AiLoreSettings } from '../utils/ai-lore'

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

function makeAnnotation(id: string, label: string): MapAnnotation {
  return {
    id,
    x: 0,
    y: 0,
    label,
    body: '',
    color: '#c4a86b',
    createdAt: 1,
  }
}

function makeJourney(id: string): SavedJourney {
  return {
    id,
    savedAt: 1,
    name: id,
    fromName: 'A',
    toName: 'B',
    waypoints: [],
    season: 'summer',
    mode: 'direct',
    totalKm: 10,
    estimatedDays: 1,
    nodeIds: ['n1', 'n2'],
    edgeCount: 1,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

function makePreset(id: string): LayerPreset {
  return {
    id,
    name: id,
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
}

function seedAllStores(): void {
  saveAnnotations([makeAnnotation('pin-1', 'Camp')])
  saveJourneys([makeJourney('j-1')])
  saveFeatureNotes({ 'feature-1': 'Note one' })
  setStarredIds(['star-1', 'star-2'])
  setPrepOrder(['prep-1', 'prep-2'])
  setPrepDoneIds(['done-1'])
  saveFeatureHooks({ 'hook-1': [{ text: 'Hook text', tags: ['tag'] }] })
  saveCustomPresets([makePreset('custom-1')])

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

describe('importCampaign', () => {
  it('replace round-trips all content and preference sections', () => {
    seedAllStores()
    const env = exportCampaign()
    localStorage.clear()

    importCampaign(env, 'replace')

    expect(loadAnnotations()).toEqual([makeAnnotation('pin-1', 'Camp')])
    expect(loadSavedJourneys()[0].id).toBe('j-1')
    expect(loadFeatureNotes()).toEqual({ 'feature-1': 'Note one' })
    expect(getStarredIds()).toEqual(['star-1', 'star-2'])
    expect(getPrepOrder()).toEqual(['prep-1', 'prep-2'])
    expect(getPrepDoneIds()).toEqual(['done-1'])
    expect(loadFeatureHooks()).toEqual({ 'hook-1': [{ text: 'Hook text', tags: ['tag'] }] })
    expect(loadCustomPresets()[0].id).toBe('custom-1')

    expect(loadTimeOfDay()).toBe('night')
    expect(loadHexSize()).toBe(70)

    const settings = loadAiLoreSettings()
    // exportCampaign strips apiKey; after clearing localStorage there is no local key to preserve.
    expect(settings.apiKey).toBeNull()
    expect(settings.endpoint).toBe('https://example.com/v1/chat/completions')
    expect(settings.model).toBe('test-model')
    expect(settings.temperature).toBe(0.7)
  })

  it('preserves the local apiKey when replacing aiLoreSettings', () => {
    const localSettings: AiLoreSettings = {
      apiKey: 'sk-LOCAL',
      endpoint: 'https://local.example.com/v1/chat/completions',
      model: 'local-model',
      temperature: 0.5,
    }
    saveAiLoreSettings(localSettings)

    // exportCampaign strips apiKey, so the envelope lacks it.
    const env = exportCampaign()
    expect(env.preferences?.aiLoreSettings).toBeDefined()
    expect('apiKey' in (env.preferences?.aiLoreSettings as object)).toBe(false)

    importCampaign(env, 'replace')

    const settings = loadAiLoreSettings()
    expect(settings.apiKey).toBe('sk-LOCAL')
    expect(settings.endpoint).toBe('https://local.example.com/v1/chat/completions')
    expect(settings.model).toBe('local-model')
    expect(settings.temperature).toBe(0.5)
  })

  it('merges annotations by id (incoming wins, existing preserved, new appended)', () => {
    const a1 = makeAnnotation('a1', 'A1')
    const a2 = makeAnnotation('a2', 'A2')
    saveAnnotations([a1, a2])

    const a2edited = makeAnnotation('a2', 'A2 edited')
    const a3 = makeAnnotation('a3', 'A3')
    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: { annotations: [a2edited, a3] },
    }

    importCampaign(env, 'merge')

    const result = loadAnnotations()
    expect(result.map(a => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(result.find(a => a.id === 'a2')?.label).toBe('A2 edited')
    expect(result.find(a => a.id === 'a1')?.label).toBe('A1')
  })

  it('merges featureNotes by key (incoming wins, absent existing keys preserved)', () => {
    saveFeatureNotes({ f1: 'x', fKeep: 'orig' })

    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: { featureNotes: { f1: 'y', f2: 'z' } },
    }

    importCampaign(env, 'merge')

    expect(loadFeatureNotes()).toEqual({ f1: 'y', fKeep: 'orig', f2: 'z' })
  })

  it('merges stars as a set-union without duplicates', () => {
    setStarredIds(['a', 'b'])

    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: { stars: ['b', 'c'] },
    }

    importCampaign(env, 'merge')

    expect(getStarredIds()).toEqual(['a', 'b', 'c'])
  })

  it('merge skips preferences', () => {
    saveTimeOfDay('day')

    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: {},
      preferences: { timeOfDay: 'night' },
    }

    importCampaign(env, 'merge')

    expect(loadTimeOfDay()).toBe('day')
  })

  it('rejects malformed envelopes and leaves existing data untouched', () => {
    saveAnnotations([makeAnnotation('keep', 'Keep')])

    expect(() => importCampaign({ bad: 1 }, 'replace')).toThrow()
    expect(loadAnnotations()[0].id).toBe('keep')
  })

  it('merges prepOrder and prepDone as deduped unions preserving order', () => {
    setPrepOrder(['a', 'b', 'c'])
    setPrepDoneIds(['x', 'y'])

    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: { prepOrder: ['b', 'd'], prepDone: ['y', 'z'] },
    }

    importCampaign(env, 'merge')

    expect(getPrepOrder()).toEqual(['a', 'b', 'c', 'd'])
    expect(getPrepDoneIds()).toEqual(['x', 'y', 'z'])
  })

  it('tolerates wrong-typed section payloads without crashing', () => {
    const a1 = makeAnnotation('a1', 'A1')
    saveAnnotations([a1])

    const env: CampaignEnvelope = {
      schema: 'veydria-campaign',
      version: 1,
      savedAt: 1,
      content: {
        annotations: 'oops' as unknown as MapAnnotation[],
        featureNotes: { f9: 'ok' },
      },
    }

    expect(() => importCampaign(env, 'merge')).not.toThrow()
    expect(loadAnnotations()).toEqual([a1])
    expect(loadFeatureNotes()).toEqual({ f9: 'ok' })
  })
})
