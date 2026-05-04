import { useState } from 'react'

interface LayerVisibility {
  terrain_cell: boolean
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
  isEditMode?: boolean
  onToggleEditMode?: () => void
}

interface LayerGroup {
  title: string
  layers: Array<{
    key: keyof LayerVisibility
    label: string
    color: string
    icon: string
  }>
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    title: 'Geography',
    layers: [
      { key: 'terrain_cell', label: 'Terrain', color: '#688c55', icon: '⛰' },
      { key: 'water', label: 'Basin', color: '#3a7ca5', icon: '🌊' },
      { key: 'river', label: 'Rivers', color: '#4a8ab0', icon: '〜' },
    ],
  },
  {
    title: 'Regions',
    layers: [
      { key: 'civilization', label: 'Civilizations', color: '#c4a862', icon: '🏛' },
      { key: 'landmark', label: 'Landmarks', color: '#c4a862', icon: '◆' },
      { key: 'oasis', label: 'Oases', color: '#4a9a3a', icon: '🌿' },
      { key: 'contested_site', label: 'Sacred Sites', color: '#88ccff', icon: '✧' },
    ],
  },
  {
    title: 'Trade',
    layers: [
      { key: 'port', label: 'Ports', color: '#e8c840', icon: '⚓' },
      { key: 'chokepoint', label: 'Chokepoints', color: '#f44', icon: '⛨' },
      { key: 'trade_route', label: 'Trade Routes', color: '#d4a854', icon: '⤳' },
    ],
  },
]

function ToggleSwitch({ active, color }: { active: boolean; color: string }) {
  return (
    <span className="toggle-switch" style={{ '--toggle-color': color } as React.CSSProperties}>
      <span className={`toggle-switch-knob ${active ? 'active' : ''}`} />
    </span>
  )
}

export default function LayerControls({ layers, onToggle, isEditMode, onToggleEditMode }: LayerControlsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }))
  }

  return (
    <div className="layer-controls" id="layer-controls">
      {onToggleEditMode && (
        <button
          className={`layer-toggle edit-mode-toggle ${isEditMode ? 'active' : ''}`}
          onClick={onToggleEditMode}
          title="Toggle Edit Mode (Draggable Markers)"
        >
          <span className="layer-toggle-icon">✏️</span>
          <ToggleSwitch active={!!isEditMode} color="#ffaa00" />
          <span className="layer-toggle-label">Edit Mode</span>
        </button>
      )}

      <div className="layer-controls-title">Layers</div>

      {LAYER_GROUPS.map((group) => {
        const isCollapsed = collapsed[group.title]
        return (
          <div key={group.title} className="layer-group">
            <button
              className="layer-group-header"
              onClick={() => toggleGroup(group.title)}
              title={`Toggle ${group.title}`}
            >
              <span className={`layer-group-chevron ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
              <span className="layer-group-title">{group.title}</span>
            </button>

            {!isCollapsed && (
              <div className="layer-group-items">
                {group.layers.map(({ key, label, color, icon }) => {
                  const active = layers[key]
                  return (
                    <button
                      key={key}
                      className={`layer-toggle ${active ? 'active' : ''}`}
                      onClick={() => onToggle(key)}
                      title={`Toggle ${label}`}
                    >
                      <span className="layer-toggle-icon">{icon}</span>
                      <ToggleSwitch active={active} color={color} />
                      <span className="layer-toggle-label">{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
