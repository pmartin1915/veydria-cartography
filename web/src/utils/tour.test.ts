import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  tourReducer,
  isTourCompleted,
  markTourCompleted,
  computeCardPosition,
  MAIN_TOUR_KEY,
  JOURNEY_TUTORIAL_KEY,
  WELCOME_KEY,
  PASSAGE_TUTORIAL_KEY,
  type TourState,
} from './tour'

const STORAGE_KEY = 'veydria.tour.completed.v1'

// Mock localStorage for vitest node environment
const mockStorage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value },
  removeItem: (key: string) => { delete mockStorage[key] },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) },
})

describe('tourReducer', () => {
  it('START activates tour at step 0', () => {
    const state: TourState = { active: false, stepIndex: 0 }
    const next = tourReducer(state, { type: 'START' })
    expect(next.active).toBe(true)
    expect(next.stepIndex).toBe(0)
  })

  it('NEXT advances step', () => {
    const state: TourState = { active: true, stepIndex: 0 }
    const next = tourReducer(state, { type: 'NEXT' }, 8)
    expect(next.stepIndex).toBe(1)
  })

  it('NEXT at last step completes tour', () => {
    const state: TourState = { active: true, stepIndex: 7 }
    const next = tourReducer(state, { type: 'NEXT' }, 8)
    expect(next.active).toBe(false)
    expect(next.stepIndex).toBe(0)
  })

  it('PREV goes back', () => {
    const state: TourState = { active: true, stepIndex: 2 }
    const next = tourReducer(state, { type: 'PREV' }, 8)
    expect(next.stepIndex).toBe(1)
  })

  it('PREV at step 0 is a no-op', () => {
    const state: TourState = { active: true, stepIndex: 0 }
    const next = tourReducer(state, { type: 'PREV' }, 8)
    expect(next.stepIndex).toBe(0)
  })

  it('SKIP deactivates tour', () => {
    const state: TourState = { active: true, stepIndex: 3 }
    const next = tourReducer(state, { type: 'SKIP' }, 8)
    expect(next.active).toBe(false)
    expect(next.stepIndex).toBe(0)
  })

  it('COMPLETE deactivates tour', () => {
    const state: TourState = { active: true, stepIndex: 7 }
    const next = tourReducer(state, { type: 'COMPLETE' }, 8)
    expect(next.active).toBe(false)
    expect(next.stepIndex).toBe(0)
  })
})

describe('localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('isTourCompleted returns false when key is missing', () => {
    expect(isTourCompleted()).toBe(false)
  })

  it('isTourCompleted returns true after markTourCompleted', () => {
    markTourCompleted()
    expect(isTourCompleted()).toBe(true)
  })

  it('markTourCompleted writes completed + timestamp', () => {
    markTourCompleted(true)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.completed).toBe(true)
    expect(parsed.skipped).toBe(true)
    expect(typeof parsed.timestamp).toBe('number')
  })

  it('default key is the main tour key', () => {
    expect(MAIN_TOUR_KEY).toBe(STORAGE_KEY)
    markTourCompleted()
    expect(localStorage.getItem(MAIN_TOUR_KEY)).toBeTruthy()
  })

  it('the journey-tutorial key is tracked independently of the main tour', () => {
    // Completing the journey tutorial must NOT mark the main tour done, and
    // vice-versa — they share the engine but not the flag.
    markTourCompleted(false, JOURNEY_TUTORIAL_KEY)
    expect(isTourCompleted(JOURNEY_TUTORIAL_KEY)).toBe(true)
    expect(isTourCompleted(MAIN_TOUR_KEY)).toBe(false)

    markTourCompleted(false, MAIN_TOUR_KEY)
    expect(isTourCompleted(MAIN_TOUR_KEY)).toBe(true)
    // Journey flag still independently set.
    expect(isTourCompleted(JOURNEY_TUTORIAL_KEY)).toBe(true)
  })

  it('the welcome key is tracked independently of the tours', () => {
    // Seeing the cold-open must not mark either tour done, and completing the
    // main tour must not mark the cold-open seen.
    markTourCompleted(false, WELCOME_KEY)
    expect(isTourCompleted(WELCOME_KEY)).toBe(true)
    expect(isTourCompleted(MAIN_TOUR_KEY)).toBe(false)
    expect(isTourCompleted(JOURNEY_TUTORIAL_KEY)).toBe(false)
  })

  it('the passage tutorial key is tracked independently of the other tour keys', () => {
    expect(isTourCompleted(PASSAGE_TUTORIAL_KEY)).toBe(false)
    markTourCompleted(false, PASSAGE_TUTORIAL_KEY)
    expect(isTourCompleted(PASSAGE_TUTORIAL_KEY)).toBe(true)
    expect(isTourCompleted(MAIN_TOUR_KEY)).toBe(false)
    expect(isTourCompleted(JOURNEY_TUTORIAL_KEY)).toBe(false)
  })
})

describe('computeCardPosition', () => {
  it('centres card when targetRect is null', () => {
    const pos = computeCardPosition(null, 'bottom', 1000, 800)
    expect(pos.top).toBeGreaterThan(0)
    expect(pos.left).toBeGreaterThan(0)
    expect(pos.placement).toBe('bottom')
  })

  it('places card below target when space allows', () => {
    const rect = { top: 100, left: 100, width: 50, height: 30, bottom: 130, right: 150, x: 100, y: 100, toJSON: () => {} } as DOMRect
    const pos = computeCardPosition(rect, 'bottom', 1000, 800)
    expect(pos.top).toBeGreaterThan(rect.bottom)
    expect(pos.left).toBeGreaterThan(0)
    expect(pos.placement).toBe('bottom')
  })

  it('flips to top when bottom is off-screen', () => {
    const rect = { top: 750, left: 100, width: 50, height: 30, bottom: 780, right: 150, x: 100, y: 750, toJSON: () => {} } as DOMRect
    const pos = computeCardPosition(rect, 'bottom', 1000, 800)
    expect(pos.top).toBeLessThan(rect.top)
    expect(pos.placement).toBe('top')
  })
})
