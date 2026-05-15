import { describe, it, expect } from 'vitest'
import { buildRenderConfig } from './render-config'
import type { LayerVisibility } from '../App'

describe('buildRenderConfig', () => {
  it('includes only Python-renderable layers', () => {
    const layers: LayerVisibility = {
      terrain_cell: true,
      civilization: false,
      water: true,
      chokepoint: true,
      port: false,
      oasis: true,
      contested_site: false,
      hex_grid: true,
      trade_route: true,
      landmark: false,
      river: true,
      faction_control: true,
      terrain_cost: true,
      biome_colors: true,
    }
    const config = buildRenderConfig(layers)
    expect(config.version).toBe(1)
    expect(config.generatedAt).toBeTruthy()

    // Python-renderable layers pass through
    expect(config.layers.terrain_cell).toBe(true)
    expect(config.layers.civilization).toBe(false)
    expect(config.layers.water).toBe(true)
    expect(config.layers.chokepoint).toBe(true)
    expect(config.layers.port).toBe(false)
    expect(config.layers.oasis).toBe(true)
    expect(config.layers.contested_site).toBe(false)
    expect(config.layers.trade_route).toBe(true)
    expect(config.layers.landmark).toBe(false)
    expect(config.layers.river).toBe(true)

    // Web-only layers are omitted
    expect('hex_grid' in config.layers).toBe(false)
    expect('faction_control' in config.layers).toBe(false)
    expect('terrain_cost' in config.layers).toBe(false)
    expect('biome_colors' in config.layers).toBe(false)
  })

  it('defaults missing layers to true', () => {
    const partial = {
      terrain_cell: false,
    } as unknown as LayerVisibility
    const config = buildRenderConfig(partial)
    // Missing renderable layers should default to true
    expect(config.layers.civilization).toBe(true)
    expect(config.layers.water).toBe(true)
  })
})
