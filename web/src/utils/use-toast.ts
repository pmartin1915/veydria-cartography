import { useState, useRef, useCallback, useEffect } from 'react'

interface ToastState {
  message: string | null
  leaving: boolean
}

/**
 * Animated toast hook with graceful exit animation.
 *
 * Usage:
 *   const [message, leaving, show] = useToast(2000)
 *   show('Saved!')
 *   // render: <div className={`toast ${leaving ? 'exiting' : ''}`}>{message}</div>
 */
export function useToast(visibleDuration = 2000, exitDuration = 200): [string | null, boolean, (msg: string) => void] {
  const [state, setState] = useState<ToastState>({ message: null, leaving: false })
  const visibleTimerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)

  const show = useCallback(
    (msg: string) => {
      if (visibleTimerRef.current) clearTimeout(visibleTimerRef.current)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)

      setState({ message: msg, leaving: false })

      visibleTimerRef.current = window.setTimeout(() => {
        setState({ message: msg, leaving: true })
        exitTimerRef.current = window.setTimeout(() => {
          setState({ message: null, leaving: false })
        }, exitDuration)
      }, visibleDuration)
    },
    [visibleDuration, exitDuration]
  )

  useEffect(() => {
    return () => {
      if (visibleTimerRef.current) clearTimeout(visibleTimerRef.current)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  return [state.message, state.leaving, show]
}
