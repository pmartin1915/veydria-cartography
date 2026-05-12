/**
 * feature-notes.ts — Persistent GM notes tied to specific map features
 *
 * Canonical key: veydria.featureNotes.v1
 * Schema: Record<featureId, noteText>
 */

const STORAGE_KEY = 'veydria.featureNotes.v1'

export type FeatureNotes = Record<string, string>

export function loadFeatureNotes(): FeatureNotes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: FeatureNotes = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveFeatureNotes(notes: FeatureNotes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  } catch {
    // Storage full or private mode — silently fail
  }
}

export function getFeatureNote(featureId: string): string {
  const notes = loadFeatureNotes()
  return notes[featureId] || ''
}

export function setFeatureNote(featureId: string, text: string): FeatureNotes {
  const notes = loadFeatureNotes()
  const trimmed = text.trim()
  if (trimmed) {
    notes[featureId] = trimmed
  } else {
    delete notes[featureId]
  }
  saveFeatureNotes(notes)
  return notes
}

export function deleteFeatureNote(featureId: string): FeatureNotes {
  const notes = loadFeatureNotes()
  delete notes[featureId]
  saveFeatureNotes(notes)
  return notes
}

export function getAllFeatureNotes(): { featureId: string; note: string }[] {
  const notes = loadFeatureNotes()
  return Object.entries(notes).map(([featureId, note]) => ({ featureId, note }))
}
