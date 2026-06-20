/**
 * section-registry.ts — Campaign export/import section registry.
 *
 * Adding a future feature to backup/restore means adding one entry here.
 * Reuses the existing load/save functions so their validators and migrations run for free.
 */

import { loadAnnotations, saveAnnotations } from '../utils/annotations'
import { loadSavedJourneys, saveJourneys } from '../utils/journey-saved'
import { loadFeatureNotes, saveFeatureNotes } from '../utils/feature-notes'
import { getStarredIds, setStarredIds } from '../utils/feature-stars'
import { getPrepOrder, setPrepOrder, getPrepDoneIds, setPrepDoneIds } from '../utils/session-prep'
import { loadFeatureHooks, saveFeatureHooks } from '../utils/feature-hooks'
import { loadCustomPresets, saveCustomPresets } from '../utils/layer-presets'
import { loadTimeOfDay, saveTimeOfDay } from '../utils/time-of-day'
import { loadHexSize, saveHexSize } from '../utils/hex-size'
import { loadAiLoreSettings, saveAiLoreSettings, type AiLoreSettings } from '../utils/ai-lore'
import { kvStore } from './kv-store'

export type SectionScope = 'content' | 'preference'
export type ImportMode = 'replace' | 'merge'

export interface CampaignSection<T = unknown> {
  id: string
  storageKey: string
  scope: SectionScope
  read(): T | undefined
  write(value: T, mode: ImportMode): void
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function dedupeFirst(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Merge arrays of identified records: existing order preserved, incoming wins on id collision,
// new incoming records appended. Items without a string id are skipped (tolerant of corrupt input).
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of existing) if (item && typeof (item as { id?: unknown }).id === 'string') map.set(item.id, item)
  for (const item of incoming) if (item && typeof (item as { id?: unknown }).id === 'string') map.set(item.id, item)
  return [...map.values()]
}

function stringArraySetter(
  getter: () => string[],
  setter: (ids: string[]) => void,
): CampaignSection<string[]>['write'] {
  return (value, mode) => {
    const incoming = asArray<string>(value)
    setter(mode === 'merge' ? dedupeFirst([...getter(), ...incoming]) : dedupeFirst(incoming))
  }
}

export const CAMPAIGN_SECTIONS: CampaignSection[] = [
  {
    id: 'annotations',
    storageKey: 'veydria-annotations-v2',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadAnnotations()
    },
    write(value, mode) {
      const incoming = asArray(value) as ReturnType<typeof loadAnnotations>
      saveAnnotations(mode === 'merge' ? mergeById(loadAnnotations(), incoming) : incoming)
    },
  },
  {
    id: 'journeys',
    storageKey: 'veydria.journeys.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadSavedJourneys()
    },
    write(value, mode) {
      const incoming = asArray(value) as ReturnType<typeof loadSavedJourneys>
      saveJourneys(mode === 'merge' ? mergeById(loadSavedJourneys(), incoming) : incoming)
    },
  },
  {
    id: 'featureNotes',
    storageKey: 'veydria.featureNotes.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadFeatureNotes()
    },
    write(value, mode) {
      const incoming = asRecord(value) as ReturnType<typeof loadFeatureNotes>
      saveFeatureNotes(mode === 'merge' ? { ...loadFeatureNotes(), ...incoming } : incoming)
    },
  },
  {
    id: 'stars',
    storageKey: 'veydria.stars.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return getStarredIds()
    },
    write: stringArraySetter(getStarredIds, setStarredIds),
  },
  {
    id: 'prepOrder',
    storageKey: 'veydria.prepOrder.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return getPrepOrder()
    },
    write: stringArraySetter(getPrepOrder, setPrepOrder),
  },
  {
    id: 'prepDone',
    storageKey: 'veydria.prepDone.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return getPrepDoneIds()
    },
    write: stringArraySetter(getPrepDoneIds, setPrepDoneIds),
  },
  {
    id: 'featureHooks',
    storageKey: 'veydria.hooks.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadFeatureHooks()
    },
    write(value, mode) {
      const incoming = asRecord(value) as ReturnType<typeof loadFeatureHooks>
      saveFeatureHooks(mode === 'merge' ? { ...loadFeatureHooks(), ...incoming } : incoming)
    },
  },
  {
    id: 'layerPresets',
    storageKey: 'veydria.layer.presets.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadCustomPresets()
    },
    write(value, mode) {
      const incoming = asArray(value) as ReturnType<typeof loadCustomPresets>
      saveCustomPresets(mode === 'merge' ? mergeById(loadCustomPresets(), incoming) : incoming)
    },
  },
  {
    id: 'timeOfDay',
    storageKey: 'veydria.timeOfDay.v1',
    scope: 'preference',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadTimeOfDay()
    },
    write(value) { saveTimeOfDay(value as ReturnType<typeof loadTimeOfDay>) },
  },
  {
    id: 'hexSize',
    storageKey: 'veydria.hexSize',
    scope: 'preference',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadHexSize()
    },
    write(value) { saveHexSize(value as ReturnType<typeof loadHexSize>) },
  },
  {
    id: 'aiLoreSettings',
    storageKey: 'veydria.aiLoreSettings.v1',
    scope: 'preference',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      const { apiKey: _apiKey, ...rest } = loadAiLoreSettings()
      return rest
    },
    write(value) {
      const incoming = value as AiLoreSettings
      saveAiLoreSettings({ ...incoming, apiKey: loadAiLoreSettings().apiKey })
    },
  },
]
