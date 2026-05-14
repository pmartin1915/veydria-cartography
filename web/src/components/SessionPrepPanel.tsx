import { useMemo, useState } from 'react'
import { NodeIcon, IconStar } from './icons'
import { getFeatureNote } from '../utils/feature-notes'
import { getStoredHooks } from '../utils/feature-hooks'
import type { GeoJSONFeature } from '../App'

interface SessionPrepPanelProps {
  features: GeoJSONFeature[]
  starredIds: string[]
  orderedIds?: string[]
  doneIds?: string[]
  open: boolean
  onClose: () => void
  onSelectFeature: (feature: GeoJSONFeature) => void
  onToggleStar: (featureId: string) => void
  onReorder?: (ids: string[]) => void
  onToggleDone?: (featureId: string) => void
  onExportCampaignLog?: () => void
  onStartSession?: () => void
}

function getFeatureId(f: GeoJSONFeature): string {
  return ((f as unknown as Record<string, unknown>).id as string) || (f.properties.id as string) || ''
}

function getFeatureName(f: GeoJSONFeature): string {
  return (f.properties.name as string) || 'Unknown'
}

function getFeatureCategory(f: GeoJSONFeature): string {
  return (f.properties.category as string) || 'unknown'
}

export default function SessionPrepPanel({
  features,
  starredIds,
  orderedIds,
  doneIds = [],
  open,
  onClose,
  onSelectFeature,
  onToggleStar,
  onReorder,
  onToggleDone,
  onExportCampaignLog,
  onStartSession,
}: SessionPrepPanelProps) {
  const activeIds = orderedIds ?? starredIds

  const starredFeatures = useMemo(() => {
    const map = new Map<string, GeoJSONFeature>()
    for (const f of features) {
      const id = getFeatureId(f)
      if (id) map.set(id, f)
    }
    const out: GeoJSONFeature[] = []
    for (const id of activeIds) {
      const f = map.get(id)
      if (f) out.push(f)
    }
    return out
  }, [activeIds, features])

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const doneSet = useMemo(() => new Set(doneIds), [doneIds])

  const remainingCount = starredFeatures.length - doneIds.length

  if (!open) return null

  function handleDragStart(e: React.DragEvent, id: string) {
    if (!onReorder) return
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox requires data to be set
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (!onReorder || !draggingId || draggingId === id) return
    setDragOverId(id)
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!onReorder || !draggingId || draggingId === targetId) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }
    const fromIndex = activeIds.indexOf(draggingId)
    const toIndex = activeIds.indexOf(targetId)
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }
    const next = [...activeIds]
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, draggingId)
    onReorder(next)
    setDraggingId(null)
    setDragOverId(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverId(null)
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal session-prep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="12,2 14.5,9 22,9 16,13.5 18.5,21 12,16.5 5.5,21 8,13.5 2,9 9.5,9" />
          </svg>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
            Session Prep
          </span>
          {starredFeatures.length > 0 && (
            <span className="lore-count">
              {remainingCount > 0 ? `${remainingCount} / ${starredFeatures.length}` : starredFeatures.length}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close session prep"
            title="Close (Esc)"
            style={{
              width: 28,
              height: 28,
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div className="search-results session-prep-body">
          {starredFeatures.length === 0 ? (
            <div className="session-prep-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4, marginBottom: 12 }}>
                <polygon points="12,2 14.5,9 22,9 16,13.5 18.5,21 12,16.5 5.5,21 8,13.5 2,9 9.5,9" />
              </svg>
              <p>No starred features.</p>
              <p className="session-prep-empty-hint">
                Star locations from their info panels to build your session prep list.
              </p>
            </div>
          ) : (
            <div className="session-prep-list">
              {starredFeatures.map((feature) => {
                const id = getFeatureId(feature)
                const name = getFeatureName(feature)
                const category = getFeatureCategory(feature)
                const note = getFeatureNote(id)
                const hooks = getStoredHooks(id)
                const hasContent = note || (hooks && hooks.length > 0)
                const isDone = doneSet.has(id)
                const isDragging = draggingId === id
                const isDragOver = dragOverId === id

                return (
                  <div
                    key={id}
                    className={`session-prep-card ${isDone ? 'done' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                    draggable={!!onReorder}
                    onDragStart={(e) => handleDragStart(e, id)}
                    onDragOver={(e) => handleDragOver(e, id)}
                    onDrop={(e) => handleDrop(e, id)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="session-prep-card-header">
                      <div className="session-prep-card-meta">
                        <div className="session-prep-card-top-row">
                          <div className="session-prep-card-controls">
                            {onToggleDone && (
                              <label className="prep-checkbox-label">
                                <input
                                  type="checkbox"
                                  className="prep-checkbox"
                                  checked={isDone}
                                  onChange={() => onToggleDone(id)}
                                  aria-label={`Mark ${name} as done`}
                                />
                                <span className="prep-checkbox-check" />
                              </label>
                            )}
                            {onReorder && (
                              <span className="prep-drag-handle" title="Drag to reorder">
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                  <circle cx="2" cy="2" r="1" />
                                  <circle cx="5" cy="2" r="1" />
                                  <circle cx="8" cy="2" r="1" />
                                  <circle cx="2" cy="5" r="1" />
                                  <circle cx="5" cy="5" r="1" />
                                  <circle cx="8" cy="5" r="1" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <span className={`info-panel-category ${category}`}>
                            {category.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <span className="session-prep-card-name">{name}</span>
                      </div>
                      <div className="session-prep-card-actions">
                        <button
                          className="session-prep-btn session-prep-btn--fly"
                          onClick={() => onSelectFeature(feature)}
                          title="Fly to location"
                        >
                          Fly to
                        </button>
                        <button
                          className="session-prep-btn session-prep-btn--unstar"
                          onClick={() => onToggleStar(id)}
                          title="Remove from stars"
                          aria-label="Remove from stars"
                        >
                          <IconStar size={12} />
                        </button>
                      </div>
                    </div>

                    {hasContent && (
                      <div className="session-prep-card-body">
                        {note && (
                          <p className="session-prep-note">{note}</p>
                        )}
                        {hooks && hooks.length > 0 && (
                          <div className="session-prep-hooks">
                            {hooks.flatMap((h) => h.tags).filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 6).map((tag) => (
                              <span key={tag} className="info-hook-tag">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="search-footer">
          <span><kbd>Esc</kbd> Close</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {starredFeatures.length > 0 && onExportCampaignLog && (
              <button
                type="button"
                className="keyboard-help-replay"
                onClick={onExportCampaignLog}
              >
                Export log
              </button>
            )}
            {starredFeatures.length > 0 && onStartSession && (
              <button
                type="button"
                className="session-prep-start-btn"
                onClick={onStartSession}
              >
                Start session
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
