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

// Fields to display for each category (ordered)
const CATEGORY_FIELDS: Record<string, string[]> = {
  port: ['etymology', 'location', 'function', 'real_world_parallel'],
  chokepoint: ['type', 'description', 'strategic_value', 'connects'],
  oasis: [],
  contested_site: ['location', 'description'],
  civilization: ['cardinal', 'elevation', 'terrain', 'basin_access', 'borders'],
  trade_route: ['path_description', 'commodities', 'bottleneck', 'consequence_if_closed', 'endpoints'],
  water: ['description', 'opening'],
}

// Pretty labels for field keys
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

export default function InfoPanel({ feature, open, onClose }: InfoPanelProps) {
  if (!feature) {
    return <div className={`info-panel ${open ? 'open' : ''}`} />
  }

  const props = feature.properties
  const category = (props.category as string) || 'unknown'
  const name = (props.name as string) || 'Unknown'
  const etymology = props.etymology as string | undefined
  const fields = CATEGORY_FIELDS[category] || Object.keys(props)

  return (
    <div className={`info-panel ${open ? 'open' : ''}`} id="info-panel">
      <div className="info-panel-header">
        <span className={`info-panel-category ${category}`}>
          {category.replace('_', ' ')}
        </span>
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
        <h2 className="info-panel-name">{name}</h2>

        {etymology && (
          <p className="info-panel-etymology">{etymology}</p>
        )}

        <div className="info-panel-divider" />

        {fields.map((fieldKey) => {
          // Skip fields already shown (name, category, etymology) or styling fields
          if (
            fieldKey === 'name' ||
            fieldKey === 'id' ||
            fieldKey === 'category' ||
            fieldKey === 'etymology' ||
            fieldKey.startsWith('marker-') ||
            fieldKey === 'fill' ||
            fieldKey === 'fillOpacity' ||
            fieldKey === 'stroke' ||
            fieldKey === 'stroke-width' ||
            fieldKey === 'stroke-dasharray' ||
            fieldKey === 'centroid'
          ) {
            return null
          }

          const value = props[fieldKey]
          if (value === undefined || value === null || value === '') return null

          const label = FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

          // Handle arrays (borders, connects, endpoints)
          if (Array.isArray(value)) {
            return (
              <div className="info-field" key={fieldKey}>
                <div className="info-field-label">{label}</div>
                <div className="info-tag-list">
                  {value.map((item, i) => (
                    <span className="info-tag" key={i}>
                      {String(item)}
                    </span>
                  ))}
                </div>
              </div>
            )
          }

          return (
            <div className="info-field" key={fieldKey}>
              <div className="info-field-label">{label}</div>
              <div className="info-field-value">{String(value)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
