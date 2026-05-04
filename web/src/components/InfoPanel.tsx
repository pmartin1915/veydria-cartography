import { useState } from 'react'

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
  open: boolean
  onClose: () => void
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

export default function InfoPanel({ feature, open, onClose }: InfoPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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
    <div className={`info-panel ${open ? 'open' : ''}`} id="info-panel">
      <div className={`info-panel-header info-panel-header--${category}`}>
        <div className="info-panel-header-left">
          <span className={`info-panel-category ${category}`}>
            {category.replace('_', ' ')}
          </span>
          <h2 className="info-panel-name">{name}</h2>
          {etymology && (
            <p className="info-panel-etymology">{etymology}</p>
          )}
        </div>
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

          const label = FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
      </div>
    </div>
  )
}
