import { useState, useRef, useEffect } from 'react'

interface ActivePartySelectProps {
  activePartyName: string
  partyNames: string[]
  /** Switch to an existing party (loads its most-recent journey in the container). */
  onSwitch: (name: string) => void
  /** Create a new party name and make it active (no journey loaded yet). */
  onCreate: (name: string) => void
}

/**
 * Top-of-planner "Active party" picker (Tier 2c, split-party play). Switching a
 * party loads that party's saved journeys; "+ New party" names a fresh group
 * that the next Save will be tagged with. Built on the journey-dropdown markup
 * but carries a scoped accent (`.journey-party-select`, see App.css) so it reads
 * as ambient campaign state, not a From/To route input. Owns its own open /
 * create-draft state and outside-click close.
 */
export default function ActivePartySelect({ activePartyName, partyNames, onSwitch, onCreate }: ActivePartySelectProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function commitCreate() {
    const name = draft.trim()
    if (name) onCreate(name)
    setDraft('')
    setCreating(false)
    setOpen(false)
  }

  return (
    <div className="journey-field journey-party-select" ref={ref}>
      <label className="journey-field-label">Active party</label>
      <div className="journey-dropdown">
        <button
          className="journey-dropdown-trigger"
          onClick={() => setOpen(o => !o)}
          title="Switch the active party — saving tags routes with this party, and the campaign log groups by it"
        >
          <span>{activePartyName}</span>
          <span className={`journey-dropdown-arrow ${open ? 'open' : ''}`}>▾</span>
        </button>
        {open && (
          <div className="journey-dropdown-menu">
            <div className="journey-dropdown-list">
              {partyNames.map(name => (
                <button
                  key={name}
                  className={`journey-dropdown-item ${name === activePartyName ? 'selected' : ''}`}
                  onClick={() => {
                    onSwitch(name)
                    setOpen(false)
                    setCreating(false)
                  }}
                >
                  <span className="journey-dropdown-item-name">{name}</span>
                </button>
              ))}
            </div>
            {creating ? (
              <input
                type="text"
                className="journey-dropdown-search"
                placeholder="New party name…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCreate()
                  if (e.key === 'Escape') { setCreating(false); setDraft('') }
                }}
                autoFocus
              />
            ) : (
              <button
                className="journey-dropdown-item journey-party-add"
                onClick={() => setCreating(true)}
              >
                + New party
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
