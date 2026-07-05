// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TrailVista from './TrailVista'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setupMocks() {
  const stubCtx = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    imageSmoothingEnabled: false,
  }

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (type: string) => (type === '2d' ? (stubCtx as unknown as CanvasRenderingContext2D) : null),
  )

  let reducedMotion = false
  const mediaObjects: {
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  }[] = []

  const matchMediaStub = vi.fn().mockImplementation(() => {
    const obj = {
      get matches() {
        return reducedMotion
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    mediaObjects.push(obj)
    return obj
  })
  vi.stubGlobal('matchMedia', matchMediaStub)

  let rafId = 0
  const rafCallbacks = new Map<number, FrameRequestCallback>()
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = ++rafId
    rafCallbacks.set(id, cb)
    return id
  })
  const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    rafCallbacks.delete(id)
  })

  return {
    stubCtx,
    mediaObjects,
    get reducedMotion() {
      return reducedMotion
    },
    set reducedMotion(value: boolean) {
      reducedMotion = value
    },
    rafSpy,
    cafSpy,
    rafCallbacks,
    matchMediaStub,
  }
}

describe('TrailVista', () => {
  it('renders a canvas with the expected test id and aria-hidden', () => {
    setupMocks()
    render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    const canvas = screen.getByTestId('trail-vista')
    expect(canvas).toBeTruthy()
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.getAttribute('width')).toBe('320')
    expect(canvas.getAttribute('height')).toBe('88')
  })

  it('does not schedule a rAF burst on initial mount', () => {
    const { rafSpy } = setupMocks()
    render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('schedules a rAF frame when dayNum changes', () => {
    const { rafSpy } = setupMocks()
    const { rerender } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    expect(rafSpy).not.toHaveBeenCalled()
    rerender(<TrailVista biome="Desert" dayNum={2} paused={false} seed={42} />)
    expect(rafSpy).toHaveBeenCalled()
  })

  it('does not schedule rAF when paused is true on a dayNum change', () => {
    const { rafSpy } = setupMocks()
    const { rerender } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    rerender(<TrailVista biome="Desert" dayNum={2} paused={true} seed={42} />)
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('does not schedule rAF when reduced motion is preferred', () => {
    const mocks = setupMocks()
    mocks.reducedMotion = true
    const { rerender } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    rerender(<TrailVista biome="Desert" dayNum={2} paused={false} seed={42} />)
    expect(mocks.rafSpy).not.toHaveBeenCalled()
  })

  it('cancels the pending rAF when paused becomes true mid-burst', () => {
    const { rafSpy, cafSpy } = setupMocks()
    const { rerender } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    rerender(<TrailVista biome="Desert" dayNum={2} paused={false} seed={42} />)
    expect(rafSpy).toHaveBeenCalled()
    rerender(<TrailVista biome="Desert" dayNum={2} paused={true} seed={42} />)
    expect(cafSpy).toHaveBeenCalled()
  })

  it('cancels rAF and removes the matchMedia listener on unmount mid-burst', () => {
    const { rafSpy, cafSpy, mediaObjects } = setupMocks()
    const { rerender, unmount } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    rerender(<TrailVista biome="Desert" dayNum={2} paused={false} seed={42} />)
    expect(rafSpy).toHaveBeenCalled()
    unmount()
    expect(cafSpy).toHaveBeenCalled()
    expect(mediaObjects).toHaveLength(1)
    expect(mediaObjects[0].removeEventListener).toHaveBeenCalled()
  })

  it('repaints without rAF when biome changes but dayNum does not', () => {
    const { rafSpy, stubCtx } = setupMocks()
    const { rerender } = render(<TrailVista biome="Desert" dayNum={1} paused={false} seed={42} />)
    const initialClear = stubCtx.clearRect.mock.calls.length
    const initialFill = stubCtx.fillRect.mock.calls.length
    rerender(<TrailVista biome="Steppe" dayNum={1} paused={false} seed={42} />)
    expect(stubCtx.clearRect.mock.calls.length).toBeGreaterThan(initialClear)
    expect(stubCtx.fillRect.mock.calls.length).toBeGreaterThan(initialFill)
    expect(rafSpy).not.toHaveBeenCalled()
  })
})
