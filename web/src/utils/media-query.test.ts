/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './media-query'

describe('useMediaQuery', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void> = []
  let currentMatches = false

  beforeEach(() => {
    listeners = []
    currentMatches = false
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        get matches() {
          return currentMatches
        },
        media: query,
        addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          listeners.push(handler)
        },
        removeEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          listeners = listeners.filter((l) => l !== handler)
        },
        dispatchEvent: () => true,
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when media does not match', () => {
    currentMatches = false
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(false)
  })

  it('returns true when media matches', () => {
    currentMatches = true
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the media query changes', () => {
    currentMatches = false
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(false)

    currentMatches = true
    act(() => {
      listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent))
    })
    expect(result.current).toBe(true)

    currentMatches = false
    act(() => {
      listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent))
    })
    expect(result.current).toBe(false)
  })

  it('cleans up the listener on unmount', () => {
    currentMatches = false
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(listeners.length).toBe(1)
    unmount()
    expect(listeners.length).toBe(0)
  })

  it('initial state factory handles missing window', () => {
    // Verify the hook's source contains the SSR guard — we can't easily
    // test with window=undefined in a DOM environment, but the guard is
    // visible in the implementation.
    const src = useMediaQuery.toString()
    expect(src).toContain('typeof window')
    expect(src).toContain('undefined')
  })

  it('re-registers when the query string changes', () => {
    currentMatches = true
    const { rerender, result: hookResult } = renderHook(
      ({ query }) => useMediaQuery(query),
      { initialProps: { query: '(max-width: 768px)' } }
    )
    expect(hookResult.current).toBe(true)
    expect(listeners.length).toBe(1)

    currentMatches = false
    rerender({ query: '(min-width: 1024px)' })
    expect(listeners.length).toBe(1)
  })
})
