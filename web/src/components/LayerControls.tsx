interface LayerVisibility {
  civilization: boolean
  water: boolean
  chokepoint: boolean
  port: boolean
  oasis: boolean
  contested_site: boolean
  trade_route: boolean
  landmark: boolean
  river: boolean
}

interface LayerControlsProps {
  layers: LayerVisibility
  onToggle: (layer: keyof LayerVisibility) => void
}

const LAYER_CONFIG: Array<{
  key: keyof LayerVisibility
  label: string
  color: string
  icon: string
}> = [
  { key: 'civilization', label: 'Regions', color: '#c4a862', icon: '🏛' },
  { key: 'water', label: 'Basin', color: '#3a7ca5', icon: '🌊' },
  { key: 'port', label: 'Ports', color: '#e8c840', icon: '⚓' },
  { key: 'chokepoint', label: 'Chokepoints', color: '#f44', icon: '⛨' },
  { key: 'oasis', label: 'Oases', color: '#4a9a3a', icon: '🌿' },
  { key: 'landmark', label: 'Landmarks', color: '#c4a862', icon: '◆' },
  { key: 'contested_site', label: 'Sacred Sites', color: '#88ccff', icon: '✧' },
  { key: 'trade_route', label: 'Trade Routes', color: '#d4a854', icon: '⤳' },
  { key: 'river', label: 'Rivers', color: '#4a8ab0', icon: '〜' },
]

export default function LayerControls({ layers, onToggle }: LayerControlsProps) {
  return (
    <div className="layer-controls" id="layer-controls">
      <div className="layer-controls-title">Layers</div>
      {LAYER_CONFIG.map(({ key, label, color, icon }) => {
        const active = layers[key]
        return (
          <button
            key={key}
            className={`layer-toggle ${active ? 'active' : ''}`}
            onClick={() => onToggle(key)}
            title={`Toggle ${label}`}
          >
            <span className="layer-toggle-icon">{icon}</span>
            <span className="layer-toggle-dot" style={{ background: active ? color : 'transparent', borderColor: color }} />
            <span className="layer-toggle-label">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
