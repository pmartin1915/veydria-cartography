import { useState } from 'react'
import type { LayerVisibility } from '../App'
import { MARKER_SVGS, CIV_COLORS, ELEVATION_STOPS } from '../utils/map-style'
import { BIOME_COLORS } from '../utils/hex-grid'
import { CIV_LABELS } from './compendium/types'

// Point-feature rows. `category` keys MARKER_SVGS; `colorVar` mirrors the
// `.marker-*` CSS color so the key glyph matches the map without inheriting the
// markers' hover-scale / pulse animation.
const POINT_FEATURES: {
  layer: keyof LayerVisibility
  category: string
  label: string
  colorVar: string
}[] = [
  { layer: 'port', category: 'port', label: 'Port', colorVar: 'var(--color-port)' },
  { layer: 'oasis', category: 'oasis', label: 'Oasis', colorVar: 'var(--color-oasis)' },
  { layer: 'chokepoint', category: 'chokepoint', label: 'Chokepoint', colorVar: 'var(--color-chokepoint)' },
  { layer: 'contested_site', category: 'contested_site', label: 'Contested site', colorVar: 'var(--color-contested)' },
  { layer: 'landmark', category: 'landmark', label: 'Landmark', colorVar: 'var(--color-landmark)' },
]

// CIV_COLORS keys use underscores (`ngaru_bon`); CIV_LABELS uses hyphens
// (`ngaru-bon`). Normalize before lookup, title-case the slug as a fallback.
function civLabel(slug: string): string {
  const normalized = slug.replace(/_/g, '-')
  const label = (CIV_LABELS as Record<string, string>)[normalized]
  if (label) return label
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
}

// Distinctive biomes worth a key entry — mirrors the filter the map fill uses;
// elevation fallback buckets (Sea/Plains/Hill/…) are intentionally omitted.
const LEGEND_BIOMES = [
  'Cloud forest', 'Highland savanna', 'Desert', 'Steppe', 'Monsoon delta',
  'Volcanic archipelago', 'Miombo woodland', 'Afroalpine heath', 'River gorge',
  'Sabkha', 'Oasis', 'Escarpment', 'Mangrove swamp', 'Floodplain', 'Coral reef',
  'Geothermal vent',
]

/**
 * On-map key. Each section documents one family of map symbols and is shown only
 * when its layer(s) are active, so the key always reflects what's actually drawn.
 * Renders nothing when no documented layer is on (matching the old biome legend).
 */
export default function MapKey({ layers }: { layers: LayerVisibility }) {
  // Default open on desktop, collapsed on mobile so it doesn't cover the map.
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 768))

  const showPoints = layers.port || layers.oasis || layers.chokepoint || layers.contested_site || layers.landmark
  const showCivs = layers.faction_control || layers.civilization
  const showElevation = layers.terrain_cell || layers.terrain_cost
  const showBiomes = layers.hex_grid && layers.biome_colors
  const showFog = layers.explored
  const showMarginalia = layers.marginalia

  if (!showPoints && !showCivs && !showElevation && !showBiomes && !showFog && !showMarginalia) return null

  return (
    <div className="map-key" data-testid="map-key">
      <button
        type="button"
        className={`map-key-toggle ${open ? 'open' : ''}`}
        data-testid="map-key-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={open ? 'Collapse map key' : 'Expand map key'}
      >
        <span className="map-key-toggle-label">Map Key</span>
        <span className="map-key-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="map-key-body" data-testid="map-key-body">
          {showPoints && (
            <section className="map-key-section">
              <div className="map-key-section-title">Features</div>
              {POINT_FEATURES.filter(f => layers[f.layer]).map(f => (
                <div key={f.layer} className="map-key-item">
                  <span
                    className="map-key-marker"
                    style={{ color: f.colorVar }}
                    dangerouslySetInnerHTML={{ __html: MARKER_SVGS[f.category] }}
                  />
                  <span className="map-key-label">{f.label}</span>
                </div>
              ))}
            </section>
          )}

          {showCivs && (
            <section className="map-key-section">
              <div className="map-key-section-title">Civilizations</div>
              {Object.entries(CIV_COLORS).map(([slug, color]) => (
                <div key={slug} className="map-key-item">
                  <span className="map-key-swatch" style={{ backgroundColor: color }} />
                  <span className="map-key-label">{civLabel(slug)}</span>
                </div>
              ))}
            </section>
          )}

          {showElevation && (
            <section className="map-key-section">
              <div className="map-key-section-title">Elevation</div>
              {ELEVATION_STOPS.map(stop => (
                <div key={stop.label} className="map-key-item">
                  <span className="map-key-swatch" style={{ backgroundColor: stop.color }} />
                  <span className="map-key-label">{stop.label}</span>
                </div>
              ))}
            </section>
          )}

          {showBiomes && (
            <section className="map-key-section">
              <div className="map-key-section-title">Biomes</div>
              {LEGEND_BIOMES.map(name => (
                <div key={name} className="map-key-item">
                  <span
                    className="map-key-swatch"
                    style={{ backgroundColor: (BIOME_COLORS as Record<string, string>)[name] }}
                  />
                  <span className="map-key-label">{name}</span>
                </div>
              ))}
            </section>
          )}

          {showFog && (
            <section className="map-key-section">
              <div className="map-key-section-title">Exploration</div>
              <div className="map-key-item">
                <span className="map-key-swatch map-key-swatch-fog" />
                <span className="map-key-label">Dimmed = unexplored</span>
              </div>
            </section>
          )}

          {showMarginalia && (
            <section className="map-key-section">
              <div className="map-key-section-title">Marginalia</div>
              <div className="map-key-item">
                <span className="map-key-marker" style={{ color: 'var(--text-accent)' }}>
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <path d="M8 1.5 L9.4 6.2 L14 6.6 L10.3 9.4 L11.6 14 L8 11.2 L4.4 14 L5.7 9.4 L2 6.6 L6.6 6.2 Z" />
                  </svg>
                </span>
                <span className="map-key-label">Nakhoda star-figures</span>
              </div>
              <div className="map-key-item">
                <span className="map-key-marker" style={{ color: 'var(--text-accent)' }}>
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <path d="M2 8 C4 4.5 10 4.5 12 8 C10 11.5 4 11.5 2 8 Z" fillOpacity="0.55" />
                    <path d="M12 8 L15 5.5 L15 10.5 Z" fillOpacity="0.55" />
                  </svg>
                </span>
                <span className="map-key-label">Ocean-fauna engravings</span>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
