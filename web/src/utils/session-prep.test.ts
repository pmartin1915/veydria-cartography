import { describe, it, expect, beforeEach } from 'vitest'
import {
  getPrepOrder,
  setPrepOrder,
  movePrepItem,
  getPrepDoneIds,
  togglePrepDone,
  clearPrepDone,
  syncPrepOrder,
  syncPrepDone,
  exportPrepMarkdown,
  downloadPrepList,
  isSessionActive,
  setSessionActive,
  type PrepItem,
} from './session-prep'

const ORDER_KEY = 'veydria.prepOrder.v1'
const DONE_KEY = 'veydria.prepDone.v1'
const ACTIVE_KEY = 'veydria.sessionActive.v1'

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

describe('getPrepOrder / setPrepOrder', () => {
  it('returns empty array when nothing stored', () => {
    expect(getPrepOrder()).toEqual([])
  })

  it('round-trips an array of ids', () => {
    setPrepOrder(['a', 'b', 'c'])
    expect(getPrepOrder()).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for invalid JSON', () => {
    localStorage.setItem(ORDER_KEY, 'not-json')
    expect(getPrepOrder()).toEqual([])
  })

  it('returns empty array for non-string array items', () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(['a', 1, 'b']))
    expect(getPrepOrder()).toEqual([])
  })
})

describe('movePrepItem', () => {
  it('moves an item forward', () => {
    const result = movePrepItem(['a', 'b', 'c'], 0, 2)
    expect(result).toEqual(['b', 'c', 'a'])
    expect(getPrepOrder()).toEqual(['b', 'c', 'a'])
  })

  it('moves an item backward', () => {
    const result = movePrepItem(['a', 'b', 'c'], 2, 0)
    expect(result).toEqual(['c', 'a', 'b'])
  })

  it('returns same array for out-of-bounds indices', () => {
    const arr = ['a', 'b']
    expect(movePrepItem(arr, -1, 1)).toEqual(arr)
    expect(movePrepItem(arr, 0, 5)).toEqual(arr)
  })

  it('returns same array when from === to', () => {
    const arr = ['a', 'b', 'c']
    expect(movePrepItem(arr, 1, 1)).toEqual(arr)
  })
})

describe('getPrepDoneIds / togglePrepDone', () => {
  it('returns empty array initially', () => {
    expect(getPrepDoneIds()).toEqual([])
  })

  it('adds an id and returns true', () => {
    expect(togglePrepDone('x')).toBe(true)
    expect(getPrepDoneIds()).toEqual(['x'])
  })

  it('removes an id and returns false', () => {
    togglePrepDone('x')
    expect(togglePrepDone('x')).toBe(false)
    expect(getPrepDoneIds()).toEqual([])
  })

  it('handles multiple ids', () => {
    togglePrepDone('a')
    togglePrepDone('b')
    togglePrepDone('a')
    expect(getPrepDoneIds()).toEqual(['b'])
  })
})

describe('clearPrepDone', () => {
  it('removes all done entries', () => {
    togglePrepDone('a')
    togglePrepDone('b')
    clearPrepDone()
    expect(getPrepDoneIds()).toEqual([])
    expect(localStorage.getItem(DONE_KEY)).toBeNull()
  })
})

describe('syncPrepOrder', () => {
  it('removes ids that are no longer starred', () => {
    setPrepOrder(['a', 'b', 'c'])
    const result = syncPrepOrder(['a', 'c'])
    expect(result).toEqual(['a', 'c'])
  })

  it('appends newly-starred ids to the end', () => {
    setPrepOrder(['a', 'b'])
    const result = syncPrepOrder(['a', 'b', 'c'])
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('preserves existing order for remaining ids and appends new ones', () => {
    setPrepOrder(['c', 'a', 'b'])
    const result = syncPrepOrder(['a', 'b', 'd'])
    expect(result).toEqual(['a', 'b', 'd'])
  })
})

describe('syncPrepDone', () => {
  it('removes done ids that are no longer starred', () => {
    localStorage.setItem(DONE_KEY, JSON.stringify(['a', 'b', 'c']))
    const result = syncPrepDone(['a', 'c'])
    expect(result).toEqual(['a', 'c'])
  })

  it('returns empty array when nothing starred', () => {
    localStorage.setItem(DONE_KEY, JSON.stringify(['a']))
    const result = syncPrepDone([])
    expect(result).toEqual([])
  })
})

describe('exportPrepMarkdown', () => {
  it('returns empty string for empty items', () => {
    expect(exportPrepMarkdown([])).toBe('')
  })

  it('renders a simple checklist', () => {
    const items: PrepItem[] = [
      { id: 'a', name: 'Oravan', category: 'civilization', done: false },
      { id: 'b', name: 'Aethelian Basin', category: 'water', done: true },
    ]
    const md = exportPrepMarkdown(items)
    expect(md).toContain('# Veydria Session Prep')
    expect(md).toContain('## Prep List (1 / 2 remaining)')
    expect(md).toContain('- [ ] **Oravan** (civilization)')
    expect(md).toContain('- [x] **Aethelian Basin** (water)')
    expect(md).toContain('*Exported from Veydria Cartography*')
  })

  it('includes notes and hook tags', () => {
    const items: PrepItem[] = [
      {
        id: 'a',
        name: 'Copper Road',
        category: 'trade_route',
        done: false,
        note: 'Bandits spotted near the bridge',
        hookTags: ['conflict', 'treasure'],
      },
    ]
    const md = exportPrepMarkdown(items)
    expect(md).toContain('- [ ] **Copper Road** (trade route)')
    expect(md).toContain('  - *Note:* Bandits spotted near the bridge')
    expect(md).toContain('  - *Hooks:* conflict, treasure')
  })

  it('replaces underscores in category names', () => {
    const items: PrepItem[] = [
      { id: 'a', name: 'X', category: 'contested_site', done: false },
    ]
    const md = exportPrepMarkdown(items)
    expect(md).toContain('(contested site)')
  })
})

describe('downloadPrepList', () => {
  it('does nothing for empty items', () => {
    // Should not throw
    downloadPrepList([])
  })
})

describe('isSessionActive / setSessionActive', () => {
  it('returns false when nothing stored', () => {
    expect(isSessionActive()).toBe(false)
  })

  it('returns true after activation', () => {
    setSessionActive(true)
    expect(isSessionActive()).toBe(true)
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('1')
  })

  it('returns false after deactivation', () => {
    setSessionActive(true)
    setSessionActive(false)
    expect(isSessionActive()).toBe(false)
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
  })

  it('survives a round-trip through localStorage', () => {
    setSessionActive(true)
    expect(isSessionActive()).toBe(true)
    // Simulate reload by re-reading
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('1')
  })
})
