import { useMemo } from 'react'
import { NodeIcon, IconStar } from './icons'
import { getFeatureNote } from '../utils/feature-notes'
import { getStoredHooks } from '../utils/feature-hooks'
import type { GeoJSONFeature } from '../App'

interface SessionPrepPanelProps {
  features: GeoJSONFeature[]
  starredIds: string[]
  open: boolean
  onClose: () => void
  onSelectFeature: (feature: GeoJSONFeature) => void
  onToggleStar: (featureId: string) => void
  onExportCampaignLog?: () => void
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
  open,
  onClose,
  onSelectFeature,
  onToggleStar,
  onExportCampaignLog,
}: SessionPrepPanelProps) {
  const starredFeatures = useMemo(() => {
    const map = new Map<string, GeoJSONFeature>()
    for (const f of features) {
      const id = getFeatureId(f)
      if (id) map.set(id, f)
    }
    const out: GeoJSONFeature[] = []
    for (const id of starredIds) {
      const f = map.get(id)
      if (f) out.push(f)
    }
    return out
  }, [starredIds, features])

  if (!open) return null

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
            <span className="lore-count">{starredFeatures.length}</span>
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

                return (
                  <div key={id} className="session-prep-card">
                    <div className="session-prep-card-header">
                      <div className="session-prep-card-meta">
                        <span className={`info-panel-category ${category}`}>
                          {category.replaceAll('_', ' ')}
                        </span>
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
          {starredFeatures.length > 0 && onExportCampaignLog && (
            <button
              type="button"
              className="keyboard-help-replay"
              onClick={onExportCampaignLog}
            >
              Export log
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
