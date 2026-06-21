/**
 * tour.ts — Guided tour state machine and step definitions
 *
 * A lightweight, DOM-targeted walkthrough for first-time users.
 * Steps reference elements via `data-tour` attributes so renaming
 * CSS classes doesn't break the tour.
 */

import { kvStore } from '../persistence/kv-store'

export interface TourStep {
  id: string
  targetSelector?: string
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  onEnter?: () => void
  onLeave?: () => void
}

export interface TourState {
  active: boolean
  stepIndex: number
}

export type TourAction =
  | { type: 'START' }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SKIP' }
  | { type: 'COMPLETE' }

export function tourReducer(state: TourState, action: TourAction, stepCount = 8): TourState {
  switch (action.type) {
    case 'START':
      return { active: true, stepIndex: 0 }
    case 'NEXT': {
      const next = state.stepIndex + 1
      if (next >= stepCount) return { active: false, stepIndex: 0 }
      return { ...state, stepIndex: next }
    }
    case 'PREV': {
      const prev = state.stepIndex - 1
      if (prev < 0) return state
      return { ...state, stepIndex: prev }
    }
    case 'SKIP':
    case 'COMPLETE':
      return { active: false, stepIndex: 0 }
    default:
      return state
  }
}

/** First-run map tour. */
export const MAIN_TOUR_KEY = 'veydria.tour.completed.v1'
/** Planner-scoped journey walkthrough — a separate flag so completing one
 *  tour never marks the other done. Reuses the same engine + overlay. */
export const JOURNEY_TUTORIAL_KEY = 'veydria.journey.tutorial.completed.v1'
/** First-run atmospheric cold-open shown once before the map tour.
 *  Persisted with the same shape via isTourCompleted/markTourCompleted. */
export const WELCOME_KEY = 'veydria.welcome.seen.v1'

export function isTourCompleted(key: string = MAIN_TOUR_KEY): boolean {
  try {
    const raw = kvStore.getString(key)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return parsed?.completed === true
  } catch {
    return false
  }
}

export function markTourCompleted(skipped = false, key: string = MAIN_TOUR_KEY): void {
  try {
    kvStore.setString(
      key,
      JSON.stringify({ completed: true, skipped, timestamp: Date.now() })
    )
  } catch {
    // ignore quota errors
  }
}

export function getTargetRect(selector: string): DOMRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  return el.getBoundingClientRect()
}

export interface CardPosition {
  top: number
  left: number
  placement: TourStep['placement']
}

const CARD_WIDTH = 320
const CARD_HEIGHT = 180 // rough max; actual is smaller, but we pad
const MARGIN = 12

export function computeCardPosition(
  targetRect: DOMRect | null,
  preferred: TourStep['placement'] = 'bottom',
  vw = window.innerWidth,
  vh = window.innerHeight
): CardPosition {
  if (!targetRect) {
    // Centred card (welcome / done steps)
    return {
      top: Math.max(20, vh / 2 - CARD_HEIGHT / 2),
      left: Math.max(20, vw / 2 - CARD_WIDTH / 2),
      placement: preferred,
    }
  }

  const cx = targetRect.left + targetRect.width / 2
  const cy = targetRect.top + targetRect.height / 2

  let top = 0
  let left = 0
  let placement = preferred

  const fitsBelow = targetRect.bottom + MARGIN + CARD_HEIGHT < vh
  const fitsAbove = targetRect.top - MARGIN - CARD_HEIGHT > 0
  const fitsRight = targetRect.right + MARGIN + CARD_WIDTH < vw
  const fitsLeft = targetRect.left - MARGIN - CARD_WIDTH > 0

  switch (preferred) {
    case 'bottom':
      if (fitsBelow) {
        top = targetRect.bottom + MARGIN
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else if (fitsAbove) {
        placement = 'top'
        top = targetRect.top - MARGIN - CARD_HEIGHT
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else if (fitsRight) {
        placement = 'right'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.right + MARGIN
      } else {
        placement = 'left'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.left - MARGIN - CARD_WIDTH
      }
      break
    case 'top':
      if (fitsAbove) {
        top = targetRect.top - MARGIN - CARD_HEIGHT
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else if (fitsBelow) {
        placement = 'bottom'
        top = targetRect.bottom + MARGIN
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else if (fitsRight) {
        placement = 'right'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.right + MARGIN
      } else {
        placement = 'left'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.left - MARGIN - CARD_WIDTH
      }
      break
    case 'right':
      if (fitsRight) {
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.right + MARGIN
      } else if (fitsLeft) {
        placement = 'left'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.left - MARGIN - CARD_WIDTH
      } else if (fitsBelow) {
        placement = 'bottom'
        top = targetRect.bottom + MARGIN
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else {
        placement = 'top'
        top = targetRect.top - MARGIN - CARD_HEIGHT
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      }
      break
    case 'left':
      if (fitsLeft) {
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.left - MARGIN - CARD_WIDTH
      } else if (fitsRight) {
        placement = 'right'
        top = Math.max(MARGIN, Math.min(vh - CARD_HEIGHT - MARGIN, cy - CARD_HEIGHT / 2))
        left = targetRect.right + MARGIN
      } else if (fitsBelow) {
        placement = 'bottom'
        top = targetRect.bottom + MARGIN
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      } else {
        placement = 'top'
        top = targetRect.top - MARGIN - CARD_HEIGHT
        left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, cx - CARD_WIDTH / 2))
      }
      break
  }

  return { top, left, placement }
}
