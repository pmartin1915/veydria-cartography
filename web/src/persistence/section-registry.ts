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

function requireReplace(mode: ImportMode): void {
  if (mode !== 'replace') {
    throw new Error('merge not implemented (Phase 5)')
  }
}

// Generic collection setter for JSON-array stores.
function stringArraySetter(
  key: string,
  setter: (ids: string[]) => void,
): CampaignSection<string[]>['write'] {
  return (value, mode) => {
    if (mode !== 'replace') {
      throw new Error('merge not implemented (Phase 5)')
    }
    setter(value as string[])
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
      requireReplace(mode)
      saveAnnotations(value as ReturnType<typeof loadAnnotations>)
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
      requireReplace(mode)
      saveJourneys(value as ReturnType<typeof loadSavedJourneys>)
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
      requireReplace(mode)
      saveFeatureNotes(value as ReturnType<typeof loadFeatureNotes>)
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
    write: stringArraySetter('veydria.stars.v1', setStarredIds),
  },
  {
    id: 'prepOrder',
    storageKey: 'veydria.prepOrder.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return getPrepOrder()
    },
    write: stringArraySetter('veydria.prepOrder.v1', setPrepOrder),
  },
  {
    id: 'prepDone',
    storageKey: 'veydria.prepDone.v1',
    scope: 'content',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return getPrepDoneIds()
    },
    write: stringArraySetter('veydria.prepDone.v1', setPrepDoneIds),
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
      requireReplace(mode)
      saveFeatureHooks(value as ReturnType<typeof loadFeatureHooks>)
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
      requireReplace(mode)
      saveCustomPresets(value as ReturnType<typeof loadCustomPresets>)
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
    write(value, mode) {
      requireReplace(mode)
      saveTimeOfDay(value as ReturnType<typeof loadTimeOfDay>)
    },
  },
  {
    id: 'hexSize',
    storageKey: 'veydria.hexSize',
    scope: 'preference',
    read() {
      if (kvStore.getString(this.storageKey) === null) return undefined
      return loadHexSize()
    },
    write(value, mode) {
      requireReplace(mode)
      saveHexSize(value as ReturnType<typeof loadHexSize>)
    },
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
    write(value, mode) {
      requireReplace(mode)
      // Phase 5 note: export omits apiKey, so replace must preserve the existing local key.
      saveAiLoreSettings(value as AiLoreSettings)
    },
  },
]
