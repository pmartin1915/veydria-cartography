import { isDefaultParty, type PartyConfig as PartyConfigType, type TravelPace, type Mount, type PartySize } from '../../utils/journey-graph'
import { IconCompass } from '../icons'

interface PartyConfigProps {
  party: PartyConfigType
  open: boolean
  onToggleOpen: () => void
  onChange: (next: PartyConfigType) => void
}

export default function PartyConfig({ party, open, onToggleOpen, onChange }: PartyConfigProps) {
  return (
    <div className="journey-party">
      <button
        className={`journey-party-toggle ${open ? 'active' : ''}`}
        onClick={onToggleOpen}
        title="Configure party pace, mount, size, and forced march"
      >
        <IconCompass />
        <span>Party</span>
        <span className="journey-party-summary">
          {isDefaultParty(party)
            ? 'default'
            : [
                party.mount === 'mounted' ? 'mounted' : null,
                party.pace !== 'normal' ? `${party.pace}` : null,
                party.size !== 'medium' ? party.size : null,
                party.forcedMarch ? 'forced' : null,
              ].filter(Boolean).join(' · ')}
        </span>
        <span className="journey-party-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="journey-party-body">
          <div className="journey-party-row">
            <span className="journey-party-label">Pace</span>
            <div className="journey-modes-row">
              {(['slow', 'normal', 'fast'] as TravelPace[]).map(p => (
                <button
                  key={p}
                  className={`journey-mode-btn ${party.pace === p ? 'active' : ''}`}
                  onClick={() => onChange({ ...party, pace: p })}
                  title={
                    p === 'slow'
                      ? 'Slow march: −25% speed, stealth-friendly'
                      : p === 'fast'
                      ? 'Fast march: +33% speed, perception penalty'
                      : 'Normal march'
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="journey-party-row">
            <span className="journey-party-label">Mount</span>
            <div className="journey-modes-row">
              {(['foot', 'mounted'] as Mount[]).map(m => (
                <button
                  key={m}
                  data-testid={`mount-${m}`}
                  className={`journey-mode-btn ${party.mount === m ? 'active' : ''}`}
                  onClick={() => onChange({ ...party, mount: m })}
                  title={m === 'mounted' ? 'Mounted: +50% on open road, no benefit through chokepoints' : 'On foot'}
                >
                  {m === 'foot' ? 'On foot' : 'Mounted'}
                </button>
              ))}
            </div>
          </div>
          <div className="journey-party-row">
            <span className="journey-party-label">Size</span>
            <div className="journey-modes-row">
              {(['small', 'medium', 'large'] as PartySize[]).map(s => (
                <button
                  key={s}
                  className={`journey-mode-btn ${party.size === s ? 'active' : ''}`}
                  onClick={() => onChange({ ...party, size: s })}
                  title={s === 'small' ? '<5 travellers' : s === 'medium' ? '5–10 travellers' : '10+ travellers — drags through chokepoints'}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="journey-party-row">
            <span className="journey-party-label">Forced march</span>
            <label className="journey-party-toggle-row">
              <input
                type="checkbox"
                checked={party.forcedMarch}
                onChange={e => onChange({ ...party, forcedMarch: e.target.checked })}
              />
              <span>+25% speed, accumulates exhaustion</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
