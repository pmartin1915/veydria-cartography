import { useState } from 'react'
import type { LayerVisibility, LayerOpacity } from '../App'

interface LayerControlsProps {
  layers: LayerVisibility
  opacities?: LayerOpacity
  onToggle: (layer: keyof LayerVisibility) => void
  onOpacityChange?: (layer: keyof LayerOpacity, value: number) => void
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
    opacityControl?: boolean
  }>
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    title: 'Geography',
    layers: [
      { key: 'terrain_cell', label: 'Terrain', color: '#688c55', icon: '⛰', opacityControl: true },
      { key: 'water', label: 'Basin', color: '#3a7ca5', icon: '🌊', opacityControl: true },
      { key: 'river', label: 'Rivers', color: '#4a8ab0', icon: '〜', opacityControl: true },
      { key: 'faction_control', label: 'Faction Overlay', color: '#c4a862', icon: '🏴' },
      { key: 'terrain_cost', label: 'Terrain Cost', color: '#c06040', icon: '🥾' },
    ],
  },
  {
    title: 'Regions',
    layers: [
      { key: 'civilization', label: 'Civilizations', color: '#c4a862', icon: '🏛', opacityControl: true },
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
      { key: 'trade_route', label: 'Trade Routes', color: '#d4a854', icon: '⤳', opacityControl: true },
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

function OpacitySlider({ value, color, onChange }: { value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div className="opacity-slider-row">
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
        className="opacity-slider"
        style={{ '--slider-color': color } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="opacity-slider-value">{Math.round(value * 100)}%</span>
    </div>
  )
}

export default function LayerControls({ layers, opacities, onToggle, onOpacityChange, isEditMode, onToggleEditMode }: LayerControlsProps) {
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
                {group.layers.map(({ key, label, color, icon, opacityControl }) => {
                  const active = layers[key]
                  const opacity = opacities?.[key] ?? 1
                  return (
                    <div key={key} className="layer-item">
                      <button
                        className={`layer-toggle ${active ? 'active' : ''}`}
                        onClick={() => onToggle(key)}
                        title={`Toggle ${label}`}
                      >
                        <span className="layer-toggle-icon">{icon}</span>
                        <ToggleSwitch active={active} color={color} />
                        <span className="layer-toggle-label">{label}</span>
                      </button>
                      {active && opacityControl && onOpacityChange && (
                        <OpacitySlider
                          value={opacity}
                          color={color}
                          onChange={(v) => onOpacityChange(key, v)}
                        />
                      )}
                    </div>
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
