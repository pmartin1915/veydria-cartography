/**
 * render-config.ts — Serialize current layer state for the Python pipeline.
 *
 * The web app exports a JSON config that `pipeline.py render-map --config`
 * reads to filter which categories are drawn in the parchment render.
 */

import type { LayerVisibility } from '../App'
import { saveTextFile, type FileExportResult } from '../persistence/file-export'

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
 * Save the render config JSON — browser download on web, native save dialog on
 * desktop (WebView2's `<a download>` is inert). See `file-export.ts`.
 */
export function downloadRenderConfig(layers: LayerVisibility): Promise<FileExportResult> {
  const config = buildRenderConfig(layers)
  const date = new Date().toISOString().slice(0, 10)
  return saveTextFile(
    `veydria-render-config-${date}.json`,
    JSON.stringify(config, null, 2),
    'application/json',
    { name: 'JSON', extensions: ['json'] },
  )
}
