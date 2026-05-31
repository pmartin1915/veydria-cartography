import { useState } from 'react'
import type { SavedJourney } from '../../utils/journey-saved'
import { formatDays } from '../../utils/journey-export'

interface SavedJourneysPanelProps {
  savedJourneys: SavedJourney[]
  onLoad: (entry: SavedJourney) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onClearAll: () => void
}

/**
 * The "My journeys" list: rename / load / delete / clear-all.
 *
 * Owns its own rename-in-progress state (renamingId / renameValue) since that
 * is purely local to this panel — the container only needs the committed name
 * via onRename.
 */
export default function SavedJourneysPanel({
  savedJourneys,
  onLoad,
  onDelete,
  onRename,
  onClearAll,
}: SavedJourneysPanelProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function commitRename(id: string) {
    onRename(id, renameValue)
    setRenamingId(null)
  }

  return (
    <div className="journey-history-panel">
      <div className="journey-history-header">
        <span className="journey-history-title">My journeys</span>
        {savedJourneys.length > 0 && (
          <button className="journey-history-clear" onClick={onClearAll}>Clear all</button>
        )}
      </div>
      {savedJourneys.length === 0 && (
        <div className="journey-history-empty">No saved journeys yet. Compute a route and click Save.</div>
      )}
      <div className="journey-history-list">
        {savedJourneys.map(entry => (
          <div key={entry.id} className="journey-history-item">
            <div className="journey-history-info">
              {renamingId === entry.id ? (
                <input
                  className="journey-history-name-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(entry.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className="journey-history-name"
                  onClick={() => {
                    setRenamingId(entry.id)
                    setRenameValue(entry.name || '')
                  }}
                  title="Click to rename"
                >
                  {entry.name || `${entry.fromName} → ${entry.waypoints.length > 0 ? entry.waypoints.join(' → ') + ' → ' : ''}${entry.toName}`}
                </div>
              )}
              <div className="journey-history-meta">
                {entry.season && <span className="journey-history-season">{entry.season}</span>}
                <span className="journey-history-mode">{entry.mode}</span>
                <span>{Math.round(entry.totalKm)} km</span>
                <span>~{formatDays(entry.estimatedDays)}</span>
              </div>
            </div>
            <div className="journey-history-actions">
              <button className="journey-history-load" onClick={() => onLoad(entry)} title="Load journey">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M12 3l9 9-9 9"/></svg>
              </button>
              <button className="journey-history-delete" onClick={() => onDelete(entry.id)} title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
