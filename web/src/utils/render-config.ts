/**
 * render-config.ts — Serialize current layer state for the Python pipeline.
 *
 * The web app exports a JSON config that `pipeline.py render-map --config`
 * reads to filter which categories are drawn in the parchment render.
 */

import type { LayerVisibility } from '../App'

export interface RenderConfig {
  version: number
  generatedAt: string
  layers: Record<string, boolean>
}

/**
 * Categories the Python rasterizer actually supports.
 * Web-only layers (hex_grid, faction_control, terrain_cost, biome_colors)
 * are omitted because they have no Python equivalent.
 */
const PYTHON_RENDERABLE = new Set([
  'terrain_cell',
  'civilization',
  'water',
  'chokepoint',
  'port',
  'oasis',
  'contested_site',
  'trade_route',
  'landmark',
  'river',
])

/**
 * Build a render config from the current layer visibility state.
 */
export function buildRenderConfig(layers: LayerVisibility): RenderConfig {
  const filtered: Record<string, boolean> = {}
  for (const key of PYTHON_RENDERABLE) {
    filtered[key] = layers[key as keyof LayerVisibility] ?? true
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    layers: filtered,
  }
}

/**
 * Trigger a browser download of the render config JSON.
 */
export function downloadRenderConfig(layers: LayerVisibility): void {
  const config = buildRenderConfig(layers)
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  a.download = `veydria-render-config-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
