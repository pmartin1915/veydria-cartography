import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { findRelatedFeatures, type RelatedFeature } from '../utils/related-features'
import { estimateTravelTime, formatTravelEstimate } from '../utils/travel-time'
import type { LoreEntry, LoreIndex } from '../App'
import type { MapAnnotation } from '../utils/annotations'
import { getFeatureNote, setFeatureNote } from '../utils/feature-notes'
import { generateFeatureHooks, getStoredHooks, storeHooks, type FeatureHook } from '../utils/feature-hooks'
import { IconRoute, IconMountain, IconAnchor, IconCircleDot, IconClock, IconLink } from './icons'

interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

interface InfoPanelProps {
  feature: GeoJSONFeature | null
  allFeatures?: GeoJSONFeature[]
  lore?: LoreIndex
  open: boolean
  onClose: () => void
  onSelectFeature?: (feature: GeoJSONFeature) => void
  annotations?: MapAnnotation[]
  onSelectAnnotation?: (annotation: MapAnnotation) => void
  onShare?: () => void
}

// Fields to display for each category
const CATEGORY_FIELDS: Record<string, string[]> = {
  port: ['etymology', 'location', 'function', 'real_world_parallel'],
  chokepoint: ['type', 'description', 'strategic_value', 'connects'],
  oasis: [],
  contested_site: ['location', 'description'],
  civilization: ['cardinal', 'elevation', 'terrain', 'basin_access', 'borders'],
  trade_route: ['path_description', 'commodities', 'bottleneck', 'consequence_if_closed', 'endpoints'],
  water: ['description', 'opening'],
  landmark: ['type', 'description'],
  river: ['description'],
}

// Pretty labels
const FIELD_LABELS: Record<string, string> = {
  etymology: 'Etymology',
  location: 'Location',
  function: 'Function',
  real_world_parallel: 'Design Analog',
  type: 'Type',
  description: 'Description',
  strategic_value: 'Strategic Value',
  connects: 'Connects',
  cardinal: 'Cardinal Position',
  elevation: 'Elevation',
  terrain: 'Terrain',
  basin_access: 'Basin Access',
  borders: 'Borders',
  path_description: 'Route Path',
  commodities: 'Commodities',
  bottleneck: 'Bottleneck',
  consequence_if_closed: 'If Closed',
  endpoints: 'Endpoints',
  opening: 'Basin Opening',
}

// Fields that are typically long and benefit from collapsing
const COLLAPSIBLE_FIELDS = new Set(['description', 'path_description', 'strategic_value'])

// Styling keys to skip
const SKIP_KEYS = new Set([
  'name', 'id', 'category', 'etymology',
  'marker-color', 'marker-symbol',
  'fill', 'fillOpacity',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
  'centroid',
])

const RELATION_COLORS: Record<RelatedFeature['relationType'], string> = {
  trade: 'var(--color-route)',
  geography: 'var(--color-oasis)',
  connection: 'var(--color-port)',
  proximity: 'var(--text-muted)',
}

const RELATION_ICONS: Record<RelatedFeature['relationType'], ReactNode> = {
  trade: <IconRoute size={12} />,
  geography: <IconMountain size={12} />,
  connection: <IconAnchor size={12} />,
  proximity: <IconCircleDot size={12} />,
}

// Lore category badge colors
const LORE_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  factions: { bg: 'rgba(200, 80, 60, 0.15)', text: '#d4a08c' },
  crisis: { bg: 'rgba(200, 80, 60, 0.15)', text: '#d4a08c' },
  magic: { bg: 'rgba(140, 100, 200, 0.15)', text: '#c4b0e0' },
  religion: { bg: 'rgba(200, 170, 80, 0.15)', text: '#e0d0a0' },
  geography: { bg: 'rgba(80, 140, 200, 0.15)', text: '#a0c8e8' },
  ecology: { bg: 'rgba(100, 180, 120, 0.15)', text: '#a8d8b8' },
  economy: { bg: 'rgba(180, 140, 80, 0.15)', text: '#d8c8a0' },
  linguistics: { bg: 'rgba(100, 180, 180, 0.15)', text: '#a0d8d8' },
  lore: { bg: 'rgba(140, 140, 140, 0.15)', text: '#c0c0c0' },
}

function getFeatureId(f: GeoJSONFeature): string {
  return ((f as unknown as Record<string, unknown>).id as string) || (f.properties.id as string) || ''
}

function LoreSection({ entries }: { entries: LoreEntry[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (entries.length === 0) return null

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="info-field" key="lore-section">
      <div className="info-field-header">
        <div className="info-field-label">Lore & Sources</div>
        <span className="lore-count">{entries.length}</span>
      </div>
      <div className="lore-entries">
        {entries.map((entry, i) => {
          const key = `${entry.source}-${i}`
          const isExpanded = expanded[key]
          const colors = LORE_CATEGORY_COLORS[entry.category] || LORE_CATEGORY_COLORS.lore
          const needsToggle = entry.summary.length > 140

          return (
            <div className="lore-entry" key={key}>
              <div className="lore-entry-header">
                <span
                  className="lore-badge"
                  style={{ background: colors.bg, color: colors.text }}
                >
                  {entry.category}
                </span>
                <span className="lore-title" title={entry.title}>
                  {entry.title}
                </span>
                {needsToggle && (
                  <button
                    className="lore-toggle"
                    onClick={() => toggle(key)}
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? '▲' : '▼'}
                  </button>
                )}
              </div>
              <div className={`lore-summary ${!isExpanded && needsToggle ? 'truncated' : ''}`}>
                {entry.summary}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function InfoPanel({ feature, allFeatures, lore, open, onClose, onSelectFeature, annotations, onSelectAnnotation, onShare }: InfoPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [gmNote, setGmNote] = useState('')
  const gmNoteDebounceRef = useRef<number | null>(null)
  const [hooks, setHooks] = useState<FeatureHook[]>([])

  const featureId = feature ? getFeatureId(feature) : ''

  useEffect(() => {
    if (featureId) {
      setGmNote(getFeatureNote(featureId))
      const stored = getStoredHooks(featureId)
      setHooks(stored ?? [])
    } else {
      setGmNote('')
      setHooks([])
    }
  }, [featureId])

  const handleGenerateHooks = useCallback(() => {
    if (!feature) return
    const id = getFeatureId(feature)
    const name = (feature.properties.name as string) || 'Unknown'
    const category = (feature.properties.category as string) || 'unknown'
    const newHooks = generateFeatureHooks(id, name, category, { count: 3 })
    setHooks(newHooks)
    storeHooks(id, newHooks)
  }, [feature])

  const handleGmNoteChange = useCallback((text: string) => {
    setGmNote(text)
    if (gmNoteDebounceRef.current) {
      window.clearTimeout(gmNoteDebounceRef.current)
    }
    gmNoteDebounceRef.current = window.setTimeout(() => {
      if (featureId) {
        setFeatureNote(featureId, text)
      }
    }, 300)
  }, [featureId])

  const related = useMemo(() => {
    if (!feature || !allFeatures) return []
    return findRelatedFeatures(feature, allFeatures)
  }, [feature, allFeatures])

  const featureLore = useMemo(() => {
    if (!feature || !lore) return []
    const id = getFeatureId(feature)
    return lore[id] || []
  }, [feature, lore])

  const linkedAnnotations = useMemo(() => {
    if (!feature || !annotations || annotations.length === 0) return []
    const id = getFeatureId(feature)
    if (!id) return []
    return annotations.filter((a) => a.featureId === id)
  }, [feature, annotations])

  const travelEstimate = useMemo(() => {
    if (!feature) return null
    return estimateTravelTime(feature)
  }, [feature])

  if (!feature) {
    return <div className={`info-panel ${open ? 'open' : ''}`} />
  }

  const props = feature.properties
  const category = (props.category as string) || 'unknown'
  const name = (props.name as string) || 'Unknown'
  const etymology = props.etymology as string | undefined
  const fields = CATEGORY_FIELDS[category] || Object.keys(props)

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className={`info-panel ${open ? 'open' : ''}`} id="info-panel" data-tour="info-panel">
      <div className={`info-panel-header info-panel-header--${category}`}>
        <div className="info-panel-header-left">
          <span className={`info-panel-category ${category}`}>
            {category.replaceAll('_', ' ')}
          </span>
          <h2 className="info-panel-name">{name}</h2>
          {etymology && (
            <p className="info-panel-etymology">{etymology}</p>
          )}
          {travelEstimate && (
            <p className="info-panel-travel">
              <span className="travel-icon"><IconClock size={12} /></span>
              {formatTravelEstimate(travelEstimate)}
            </p>
          )}
        </div>
        {onShare && (
          <button
            className="info-panel-share"
            onClick={onShare}
            title="Copy share link"
            aria-label="Copy share link"
            id="share-info-panel"
          >
            <IconLink size={14} />
          </button>
        )}
        <button
          className="info-panel-close"
          onClick={onClose}
          aria-label="Close panel"
          id="close-info-panel"
        >
          ✕
        </button>
      </div>

      <div className="info-panel-body">
        {fields.map((fieldKey) => {
          if (SKIP_KEYS.has(fieldKey)) return null

          const value = props[fieldKey]
          if (value === undefined || value === null || value === '') return null

          const label = FIELD_LABELS[fieldKey] || fieldKey.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          const isCollapsible = COLLAPSIBLE_FIELDS.has(fieldKey)
          const isCollapsed = isCollapsible && collapsed[fieldKey]

          // Arrays
          if (Array.isArray(value)) {
            return (
              <div className="info-field" key={fieldKey}>
                <div className="info-field-label">{label}</div>
                <div className="info-tag-list">
                  {value.map((item, i) => (
                    <span className="info-tag" key={i}>{String(item)}</span>
                  ))}
                </div>
              </div>
            )
          }

          const text = String(value)
          const shouldTruncate = isCollapsible && text.length > 180 && !isCollapsed

          return (
            <div className={`info-field ${isCollapsible ? 'info-field--collapsible' : ''}`} key={fieldKey}>
              <div className="info-field-header">
                <div className="info-field-label">{label}</div>
                {isCollapsible && text.length > 180 && (
                  <button
                    className="info-field-toggle"
                    onClick={() => toggleCollapse(fieldKey)}
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {isCollapsed ? '▼' : '▲'}
                  </button>
                )}
              </div>
              <div className={`info-field-value ${shouldTruncate ? 'truncated' : ''}`}>
                {text}
              </div>
            </div>
          )
        })}

        {/* Related Features */}
        {related.length > 0 && (
          <div className="info-field" key="related-features">
            <div className="info-field-header">
              <div className="info-field-label">Related</div>
            </div>
            <div className="related-features-list">
              {related.map(({ feature: rf, relation, relationType }) => {
                const rCat = (rf.properties.category as string) || 'unknown'
                const rName = (rf.properties.name as string) || 'Unknown'
                const rId = (rf.properties.id as string) || ''
                return (
                  <button
                    key={rId || rName}
                    className="related-feature-item"
                    onClick={() => onSelectFeature?.(rf)}
                    title={`${rName} — ${relation}`}
                  >
                    <span className="related-feature-icon" style={{ color: RELATION_COLORS[relationType] }}>
                      {RELATION_ICONS[relationType]}
                    </span>
                    <span className="related-feature-name">{rName}</span>
                    <span className="related-feature-relation">{relation}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Linked Notes */}
        {linkedAnnotations.length > 0 && (
          <div className="info-field" key="linked-notes">
            <div className="info-field-header">
              <div className="info-field-label">Linked Notes</div>
              <span className="lore-count">{linkedAnnotations.length}</span>
            </div>
            <div className="related-features-list">
              {linkedAnnotations.map((ann) => {
                const snippet = ann.body
                  ? ann.body.slice(0, 50) + (ann.body.length > 50 ? '…' : '')
                  : ''
                return (
                  <button
                    key={ann.id}
                    className="related-feature-item linked-note-item"
                    onClick={() => onSelectAnnotation?.(ann)}
                    title={ann.label}
                  >
                    <span
                      className="linked-note-dot"
                      style={{ background: ann.color }}
                      aria-hidden="true"
                    />
                    <span className="related-feature-name">{ann.label}</span>
                    {snippet && (
                      <span className="related-feature-relation">{snippet}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Lore & Sources */}
        <LoreSection entries={featureLore} />

        {/* Adventure Hooks */}
        <div className="info-field info-field--hooks" key="adventure-hooks">
          <div className="info-field-header">
            <div className="info-field-label">Adventure Hooks</div>
            <button
              className="info-hooks-roll-btn"
              onClick={handleGenerateHooks}
              title={hooks.length > 0 ? 'Reroll hooks' : 'Generate hooks'}
              aria-label={hooks.length > 0 ? 'Reroll hooks' : 'Generate hooks'}
            >
              ⟳ {hooks.length > 0 ? 'Reroll' : 'Roll'}
            </button>
          </div>
          {hooks.length === 0 ? (
            <p className="info-hooks-placeholder">
              Click <strong>Roll</strong> to generate 3 seeded adventure hooks for this location.
            </p>
          ) : (
            <div className="info-hooks-list">
              {hooks.map((hook, i) => (
                <div className="info-hook-card" key={i}>
                  <div className="info-hook-text">{hook.text}</div>
                  {hook.tags.length > 0 && (
                    <div className="info-hook-tags">
                      {hook.tags.map((tag) => (
                        <span className="info-hook-tag" key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GM Notes */}
        <div className="info-field info-field--gm-notes" key="gm-notes">
          <div className="info-field-header">
            <div className="info-field-label">GM Notes</div>
          </div>
          <textarea
            className="info-gm-notes-textarea"
            value={gmNote}
            onChange={(e) => handleGmNoteChange(e.target.value)}
            placeholder="Add private notes about this location..."
            rows={3}
          />
        </div>
      </div>
    </div>
  )
}
