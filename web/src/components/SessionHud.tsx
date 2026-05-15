import { useMemo, useRef } from 'react'
import type { GeoJSONFeature } from '../App'

interface SessionHudProps {
  features: GeoJSONFeature[]
  starredIds: string[]
  doneIds?: string[]
  onNavigate: (feature: GeoJSONFeature) => void
  onEndSession: () => void
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

export default function SessionHud({ features, starredIds, doneIds = [], onNavigate, onEndSession }: SessionHudProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const doneSet = useMemo(() => new Set(doneIds), [doneIds])
  const remaining = starredFeatures.length - doneSet.size

  if (starredFeatures.length === 0) {
    return (
      <div className="session-hud">
        <div className="session-hud-inner">
          <span className="session-hud-count">No starred features</span>
          <button className="session-hud-end" onClick={onEndSession}>
            End session
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="session-hud">
      <div className="session-hud-inner">
        <span className="session-hud-count">
          {remaining > 0 ? `${remaining}/${starredFeatures.length} remaining` : 'All done'}
        </span>
        <div className="session-hud-scroll" ref={scrollRef}>
          {starredFeatures.map((feature) => {
            const id = getFeatureId(feature)
            const name = getFeatureName(feature)
            const category = getFeatureCategory(feature)
            const isDone = doneSet.has(id)
            return (
              <button
                key={id}
                className={`session-hud-chip ${category} ${isDone ? 'done' : ''}`}
                onClick={() => onNavigate(feature)}
                title={name}
              >
                <span className="session-hud-chip-dot" />
                <span className="session-hud-chip-name">{name}</span>
                {isDone && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="session-hud-chip-check">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
        <button className="session-hud-end" onClick={onEndSession} title="End session">
          End
        </button>
      </div>
    </div>
  )
}
