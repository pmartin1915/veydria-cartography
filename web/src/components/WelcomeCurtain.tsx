import { useEffect, useRef } from 'react'

interface WelcomeCurtainProps {
  /** Dismiss the curtain (mark seen + hand off to the map tour). */
  onBegin: () => void
}

/**
 * First-run cold-open. A single atmospheric screen that sets the grounded
 * tone before the app's UI appears — shown once (gated on WELCOME_KEY), only
 * on a fresh, non-deep-link, non-share, wide-enough visit. Reuses the
 * loading-screen aesthetic (parchment + compass + VEYDRIA) so the cold-open
 * and the load feel like one piece. One action, by design (A Dark Room
 * restraint): Enter the map.
 */
export default function WelcomeCurtain({ onBegin }: WelcomeCurtainProps) {
  const beginRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    beginRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onBegin()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBegin])

  return (
    <div className="welcome-curtain" role="dialog" aria-modal="true" aria-label="Welcome to Veydria">
      <div className="loading-parchment" />
      <div className="welcome-content">
        <svg className="welcome-compass" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="32" cy="32" r="28" strokeOpacity="0.3" />
          <circle cx="32" cy="32" r="22" strokeOpacity="0.15" strokeDasharray="2 3" />
          <path d="M32 8 L36 28 L32 32 L28 28 Z" fill="var(--text-accent)" fillOpacity="0.85" stroke="none" />
          <path d="M32 56 L28 36 L32 32 L36 36 Z" fill="var(--text-muted)" fillOpacity="0.5" stroke="none" />
          <line x1="32" y1="4" x2="32" y2="10" />
          <line x1="32" y1="54" x2="32" y2="60" />
          <line x1="4" y1="32" x2="10" y2="32" />
          <line x1="54" y1="32" x2="60" y2="32" />
        </svg>
        <h1 className="welcome-title">VEYDRIA</h1>
        <p className="welcome-tagline">Six powers. Hard roads. Longer odds.</p>
        <p className="welcome-body">
          A reference atlas for the continent and the crossings that span it.
          Survey the world at leisure — then chart a journey your party may not survive.
        </p>
        <button ref={beginRef} className="welcome-begin" onClick={onBegin}>
          Enter the map
        </button>
      </div>
    </div>
  )
}
