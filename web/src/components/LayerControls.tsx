import { useState, useEffect, useRef, type ReactNode } from 'react'
import type { LayerVisibility, LayerOpacity } from '../App'
import {
  IconMountain, IconWaves, IconRiver, IconFlag, IconFootsteps,
  IconPillars, IconLandmark, IconLeaf, IconStar, IconAnchor,
  IconShield, IconRoute, IconPencil, IconHex,
} from './icons'
import { BUILT_IN_PRESETS, loadCustomPresets, saveCustomPresets, newPresetId, type LayerPreset } from '../utils/layer-presets'

interface LayerControlsProps {
  layers: LayerVisibility
  opacities?: LayerOpacity
  onToggle: (layer: keyof LayerVisibility) => void
  onOpacityChange?: (layer: keyof LayerOpacity, value: number) => void
  onApplyPreset?: (preset: LayerPreset) => void
  isEditMode?: boolean
  onToggleEditMode?: () => void
  /**
   * Player-share mode (#share=1). On a narrow viewport we collapse the
   * panel into a small launcher so a phone player doesn't see the GM-
   * grade layer controls by default; tapping the launcher expands them.
   */
  shareMode?: boolean
  hexSize?: number
  onHexSizeChange?: (size: number) => void
}

interface LayerGroup {
  title: string
  layers: Array<{
    key: keyof LayerVisibility
    label: string
    color: string
    icon: ReactNode
    opacityControl?: boolean
  }>
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    title: 'Geography',
    layers: [
      { key: 'terrain_cell', label: 'Terrain', color: '#688c55', icon: <IconMountain />, opacityControl: true },
      { key: 'water', label: 'Basin', color: '#3a7ca5', icon: <IconWaves />, opacityControl: true },
      { key: 'river', label: 'Rivers', color: '#4a8ab0', icon: <IconRiver />, opacityControl: true },
      { key: 'faction_control', label: 'Faction Overlay', color: '#c4a862', icon: <IconFlag /> },
      { key: 'terrain_cost', label: 'Terrain Cost', color: '#c06040', icon: <IconFootsteps /> },
      { key: 'hex_grid', label: 'Hex Grid', color: '#d4a854', icon: <IconHex />, opacityControl: true },
      { key: 'biome_colors', label: 'Biome Colors', color: '#4a9a3a', icon: <IconLeaf /> },
    ],
  },
  {
    title: 'Regions',
    layers: [
      { key: 'civilization', label: 'Civilizations', color: '#c4a862', icon: <IconPillars />, opacityControl: true },
      { key: 'landmark', label: 'Landmarks', color: '#c4a862', icon: <IconLandmark /> },
      { key: 'oasis', label: 'Oases', color: '#4a9a3a', icon: <IconLeaf /> },
      { key: 'contested_site', label: 'Sacred Sites', color: '#88ccff', icon: <IconStar /> },
    ],
  },
  {
    title: 'Trade',
    layers: [
      { key: 'port', label: 'Ports', color: '#e8c840', icon: <IconAnchor /> },
      { key: 'chokepoint', label: 'Chokepoints', color: '#f44', icon: <IconShield /> },
      { key: 'trade_route', label: 'Trade Routes', color: '#d4a854', icon: <IconRoute />, opacityControl: true },
    ],
  },
  {
    title: 'Campaign',
    layers: [
      { key: 'explored', label: 'Explored hexes', color: '#c4a86b', icon: <IconFootsteps /> },
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

const HEX_SIZE_OPTIONS = [30, 50, 70] as const
function HexSizePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="hex-size-picker" onClick={(e) => e.stopPropagation()}>
      <span className="hex-size-picker-label">Cell</span>
      {HEX_SIZE_OPTIONS.map((s) => (
        <button
          key={s}
          type="button"
          className={`hex-size-picker-btn ${s === value ? 'active' : ''}`}
          onClick={() => onChange(s)}
          title={`${s === 30 ? '~600' : s === 50 ? '~220' : '~110'} hexes`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

export default function LayerControls({ layers, opacities, onToggle, onOpacityChange, onApplyPreset, isEditMode, onToggleEditMode, shareMode, hexSize, onHexSizeChange }: LayerControlsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const [customPresets, setCustomPresets] = useState<LayerPreset[]>(loadCustomPresets)
  const presetMenuRef = useRef<HTMLDivElement>(null)

  // Mobile launcher: on a narrow viewport, collapse the panel into a
  // small pill the user taps to open. Applies to BOTH GM and share
  // modes — the panel covers too much of a phone screen otherwise.
  // Desktop is unaffected.
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  const [panelOpen, setPanelOpen] = useState<boolean>(!isMobile)
  // Re-evaluate on viewport changes (orientation rotation, dev-tools
  // resize). Auto-collapse only — never auto-expand, so a user choice
  // sticks.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = () => {
      if (mq.matches) setPanelOpen(false)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  // shareMode no longer drives collapse but is still accepted by the
  // component for future use.
  void shareMode

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false)
      }
    }
    if (presetMenuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [presetMenuOpen])

  const handleApply = (preset: LayerPreset) => {
    onApplyPreset?.(preset)
    setPresetMenuOpen(false)
  }

  const handleSaveCurrent = () => {
    if (!opacities) return
    const name = window.prompt('Name this preset:')
    if (!name?.trim()) return
    const preset: LayerPreset = {
      id: newPresetId(),
      name: name.trim().slice(0, 40),
      layers: { ...layers },
      opacities: { ...opacities },
    }
    const next = [...customPresets, preset]
    setCustomPresets(next)
    saveCustomPresets(next)
  }

  const handleDeleteCustom = (id: string) => {
    const next = customPresets.filter(p => p.id !== id)
    setCustomPresets(next)
    saveCustomPresets(next)
  }

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }))
  }

  // Collapsed launcher (mobile + share mode only)
  if (!panelOpen) {
    return (
      <button
        className="layer-controls-launcher"
        onClick={() => setPanelOpen(true)}
        aria-label="Open layers panel"
      >
        <span aria-hidden>≣</span>
        <span>Layers</span>
      </button>
    )
  }

  return (
    <div className="layer-controls" id="layer-controls" data-tour="layers">
      {isMobile && (
        <button
          className="layer-controls-collapse"
          onClick={() => setPanelOpen(false)}
          aria-label="Hide layers panel"
          title="Hide"
        >
          ×
        </button>
      )}
      {onToggleEditMode && (
        <button
          className={`layer-toggle edit-mode-toggle ${isEditMode ? 'active' : ''}`}
          onClick={onToggleEditMode}
          title="Toggle Edit Mode (Draggable Markers)"
        >
          <span className="layer-toggle-icon"><IconPencil /></span>
          <ToggleSwitch active={!!isEditMode} color="#ffaa00" />
          <span className="layer-toggle-label">Edit Mode</span>
        </button>
      )}

      <div className="layer-controls-title-row">
        <span className="layer-controls-title">Layers</span>
        {onApplyPreset && (
          <div className="layer-presets-anchor" ref={presetMenuRef}>
            <button
              className={`layer-presets-toggle ${presetMenuOpen ? 'active' : ''}`}
              onClick={() => setPresetMenuOpen(o => !o)}
              title="Apply layer preset"
            >
              Presets ▾
            </button>
            {presetMenuOpen && (
              <div className="layer-presets-menu">
                <div className="layer-presets-section">Built-in</div>
                {BUILT_IN_PRESETS.map(p => (
                  <button key={p.id} className="layer-presets-item" onClick={() => handleApply(p)} data-tour={p.id === 'politics' ? 'preset-politics' : undefined}>
                    {p.name}
                  </button>
                ))}
                {customPresets.length > 0 && (
                  <>
                    <div className="layer-presets-section">Custom</div>
                    {customPresets.map(p => (
                      <div key={p.id} className="layer-presets-item-row">
                        <button className="layer-presets-item" onClick={() => handleApply(p)}>
                          {p.name}
                        </button>
                        <button
                          className="layer-presets-delete"
                          onClick={() => handleDeleteCustom(p.id)}
                          title="Delete preset"
                          aria-label="Delete preset"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </>
                )}
                <div className="layer-presets-divider" />
                <button className="layer-presets-save" onClick={handleSaveCurrent}>
                  + Save current as preset…
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                      {active && key === 'hex_grid' && onHexSizeChange && (
                        <HexSizePicker value={hexSize ?? 50} onChange={onHexSizeChange} />
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
