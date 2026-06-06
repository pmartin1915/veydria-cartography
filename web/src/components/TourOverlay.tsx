import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type TourAction,
  type TourState,
  type TourStep,
  getTargetRect,
  computeCardPosition,
  markTourCompleted,
} from '../utils/tour'

interface TourOverlayProps {
  steps: TourStep[]
  state: TourState
  dispatch: React.Dispatch<TourAction>
  /** localStorage key to mark completed on Skip/Done/Escape. Omitted → the
   *  main-tour key (see markTourCompleted's default), so existing callers are
   *  unchanged; the journey tutorial passes JOURNEY_TUTORIAL_KEY. */
  storageKey?: string
}

export default function TourOverlay({ steps, state, dispatch, storageKey }: TourOverlayProps) {
  const step = steps[state.stepIndex]
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  // Bring the target into view on step change before measuring. Tour targets
  // can live inside a scroll container (e.g. the journey planner's body), in
  // which case they — and the card anchored to them — may sit outside the
  // viewport. Instant (non-smooth) scroll so the 500ms re-measure below doesn't
  // chase an animating element. A no-op when the target is already visible.
  useEffect(() => {
    if (!state.active || !step.targetSelector) return
    const el = document.querySelector(step.targetSelector)
    el?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [state.active, state.stepIndex, step])

  // Measure target and compute card position on mount / step change / resize
  useEffect(() => {
    if (!state.active) return

    function measure() {
      const r = step.targetSelector ? getTargetRect(step.targetSelector) : null
      setRect(r)
      const pos = computeCardPosition(r, step.placement)
      setCardPos({ top: pos.top, left: pos.left })
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const id = window.setInterval(measure, 500) // recheck in case layout shifts
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(id)
    }
  }, [state.active, state.stepIndex, step])

  // Run onEnter / onLeave callbacks
  useEffect(() => {
    if (!state.active) return
    step.onEnter?.()
    return () => {
      step.onLeave?.()
    }
  }, [state.active, state.stepIndex, step])

  // Keyboard navigation
  useEffect(() => {
    if (!state.active) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        dispatch({ type: 'NEXT' })
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        dispatch({ type: 'PREV' })
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        markTourCompleted(true, storageKey)
        dispatch({ type: 'SKIP' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state.active, dispatch, storageKey])

  const spotlightStyle = useMemo(() => {
    if (!rect) return { display: 'none' as const }
    const padding = 6
    return {
      display: 'block' as const,
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    }
  }, [rect])

  if (!state.active) return null

  const isFirst = state.stepIndex === 0
  const isLast = state.stepIndex === steps.length - 1

  return (
    <div className="tour-overlay" aria-hidden="false">
      {/* Dark backdrop with a spotlight cutout */}
      <div className="tour-backdrop" />
      <div className="tour-spotlight" style={spotlightStyle} />

      {/* Tour card */}
      <div
        ref={cardRef}
        className={`tour-card tour-card--${step.placement ?? 'center'}`}
        style={{ top: cardPos.top, left: cardPos.left }}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${state.stepIndex + 1} of ${steps.length}`}
      >
        <div className="tour-card-header">
          <span className="tour-card-step">
            {state.stepIndex + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="tour-card-skip"
            onClick={() => {
              markTourCompleted(true, storageKey)
              dispatch({ type: 'SKIP' })
            }}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>
        <h3 className="tour-card-title">{step.title}</h3>
        <p className="tour-card-body">{step.body}</p>
        <div className="tour-card-actions">
          {!isFirst && (
            <button
              type="button"
              className="tour-btn tour-btn--secondary"
              onClick={() => dispatch({ type: 'PREV' })}
            >
              ← Back
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              className="tour-btn tour-btn--primary"
              onClick={() => {
                markTourCompleted(false, storageKey)
                dispatch({ type: 'COMPLETE' })
              }}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              className="tour-btn tour-btn--primary"
              onClick={() => dispatch({ type: 'NEXT' })}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
