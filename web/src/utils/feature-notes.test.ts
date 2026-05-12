import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadFeatureNotes,
  saveFeatureNotes,
  getFeatureNote,
  setFeatureNote,
  deleteFeatureNote,
  getAllFeatureNotes,
} from './feature-notes'

const STORAGE_KEY = 'veydria.featureNotes.v1'

// Minimal in-memory localStorage for the node test environment.
function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}

beforeEach(() => {
  installLocalStorageStub()
})

describe('loadFeatureNotes', () => {
  it('returns empty object when localStorage is empty', () => {
    expect(loadFeatureNotes()).toEqual({})
  })

  it('returns empty object when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(loadFeatureNotes()).toEqual({})
  })

  it('returns empty object when stored data is an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['foo']))
    expect(loadFeatureNotes()).toEqual({})
  })

  it('filters out non-string values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 'keep', b: 123, c: null }))
    expect(loadFeatureNotes()).toEqual({ a: 'keep' })
  })

  it('returns valid notes object', () => {
    const data = { 'feature-1': 'Note one', 'feature-2': 'Note two' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    expect(loadFeatureNotes()).toEqual(data)
  })
})

describe('saveFeatureNotes', () => {
  it('persists notes to localStorage', () => {
    saveFeatureNotes({ 'f-1': 'hello' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{"f-1":"hello"}')
  })
})

describe('getFeatureNote', () => {
  it('returns empty string when note does not exist', () => {
    expect(getFeatureNote('missing')).toBe('')
  })

  it('returns the note text for an existing feature', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'existing': 'hello world' }))
    expect(getFeatureNote('existing')).toBe('hello world')
  })
})

describe('setFeatureNote', () => {
  it('saves a new note', () => {
    const result = setFeatureNote('f-1', 'My note')
    expect(result).toEqual({ 'f-1': 'My note' })
    expect(getFeatureNote('f-1')).toBe('My note')
  })

  it('updates an existing note', () => {
    setFeatureNote('f-1', 'Original')
    const result = setFeatureNote('f-1', 'Updated')
    expect(result).toEqual({ 'f-1': 'Updated' })
  })

  it('trims whitespace', () => {
    setFeatureNote('f-1', '  trimmed  ')
    expect(getFeatureNote('f-1')).toBe('trimmed')
  })

  it('deletes note when text is empty', () => {
    setFeatureNote('f-1', 'Will be deleted')
    const result = setFeatureNote('f-1', '   ')
    expect(result).toEqual({})
    expect(getFeatureNote('f-1')).toBe('')
  })

  it('deletes note when text is only whitespace', () => {
    setFeatureNote('f-1', 'note')
    const result = setFeatureNote('f-1', '\t\n ')
    expect(result).toEqual({})
  })
})

describe('deleteFeatureNote', () => {
  it('removes a note', () => {
    setFeatureNote('f-1', 'note')
    const result = deleteFeatureNote('f-1')
    expect(result).toEqual({})
    expect(getFeatureNote('f-1')).toBe('')
  })

  it('is safe when note does not exist', () => {
    expect(deleteFeatureNote('missing')).toEqual({})
  })
})

describe('getAllFeatureNotes', () => {
  it('returns empty array when no notes', () => {
    expect(getAllFeatureNotes()).toEqual([])
  })

  it('returns all notes as array', () => {
    setFeatureNote('a', 'Note A')
    setFeatureNote('b', 'Note B')
    const all = getAllFeatureNotes()
    expect(all).toHaveLength(2)
    expect(all).toContainEqual({ featureId: 'a', note: 'Note A' })
    expect(all).toContainEqual({ featureId: 'b', note: 'Note B' })
  })
})
