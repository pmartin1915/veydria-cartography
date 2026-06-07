// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadCustomPresets, BUILT_IN_PRESETS } from './layer-presets'
import type { LayerVisibility, LayerOpacity } from '../App'

const STORAGE_KEY = 'veydria.layer.presets.v1'

const CURRENT_LAYERS: LayerVisibility = {
  terrain_cell: true,
  civilization: true,
  water: true,
  chokepoint: true,
  port: true,
  oasis: true,
  contested_site: true,
  hex_grid: false,
  trade_route: true,
  landmark: true,
  river: true,
  faction_control: false,
  terrain_cost: false,
  biome_colors: false,
  explored: false,
  marginalia: true,
}

const CURRENT_OPACITIES: LayerOpacity = {
  terrain_cell: 0.85,
  civilization: 0.15,
  water: 0.5,
  chokepoint: 1,
  port: 1,
  oasis: 1,
  contested_site: 1,
  hex_grid: 0.7,
  trade_route: 0.75,
  landmark: 1,
  river: 0.6,
  faction_control: 1,
  terrain_cost: 0.75,
  biome_colors: 1,
  explored: 1,
  marginalia: 1,
}

// Mirrors App.tsx onApplyPreset: { ...prev, ...preset.layers }
function applyPreset(
  prev: LayerVisibility,
  prevOp: LayerOpacity,
  presetLayers: Partial<LayerVisibility>,
  presetOp: Partial<LayerOpacity>,
): { layers: LayerVisibility; opacities: LayerOpacity } {
  return {
    layers: { ...prev, ...presetLayers } as LayerVisibility,
    opacities: { ...prevOp, ...presetOp } as LayerOpacity,
  }
}

describe('preset-apply defensive merge', () => {
  it('preserves current value for keys missing from a stale preset', () => {
    // Simulate a preset saved before `faction_control` and `terrain_cost`
    // were added to the schema.
    const stalePresetLayers = {
      terrain_cell: false,
      civilization: true,
      water: true,
      chokepoint: false,
      port: false,
      oasis: false,
      contested_site: false,
      trade_route: false,
      landmark: false,
      river: false,
    } as Partial<LayerVisibility>
    const stalePresetOpacities = {
      terrain_cell: 0.5,
      civilization: 0.3,
    } as Partial<LayerOpacity>

    const { layers, opacities } = applyPreset(
      CURRENT_LAYERS,
      CURRENT_OPACITIES,
      stalePresetLayers,
      stalePresetOpacities,
    )

    // Keys present in preset take preset value.
    expect(layers.civilization).toBe(true)
    expect(layers.terrain_cell).toBe(false)
    expect(opacities.civilization).toBe(0.3)
    expect(opacities.terrain_cell).toBe(0.5)

    // Keys missing from preset retain current state — NOT undefined.
    expect(layers.faction_control).toBe(false)
    expect(layers.terrain_cost).toBe(false)
    expect(opacities.faction_control).toBe(1)
    expect(opacities.terrain_cost).toBe(0.75)

    // No undefined values anywhere — all 12 schema keys are populated.
    for (const key of Object.keys(CURRENT_LAYERS) as (keyof LayerVisibility)[]) {
      expect(layers[key]).toBeDefined()
      expect(opacities[key]).toBeDefined()
      expect(typeof layers[key]).toBe('boolean')
      expect(typeof opacities[key]).toBe('number')
    }
  })

  it('handles a completely empty preset without producing undefined keys', () => {
    const { layers, opacities } = applyPreset(CURRENT_LAYERS, CURRENT_OPACITIES, {}, {})
    expect(layers).toEqual(CURRENT_LAYERS)
    expect(opacities).toEqual(CURRENT_OPACITIES)
  })

  it('Tactical preset dims terrain and prioritizes the hex grid', () => {
    const tactical = BUILT_IN_PRESETS.find(p => p.id === 'tactical')
    expect(tactical, 'tactical preset should exist').toBeDefined()
    expect(tactical!.layers.hex_grid).toBe(true)
    expect(tactical!.layers.terrain_cell).toBe(true)
    // Hex grid should be more prominent than terrain so the cells read first.
    expect(tactical!.opacities.hex_grid).toBeGreaterThan(tactical!.opacities.terrain_cell)
    // Politics/story noise stays out of tactical view.
    expect(tactical!.layers.civilization).toBe(false)
    expect(tactical!.layers.trade_route).toBe(false)
    expect(tactical!.layers.faction_control).toBe(false)
  })

  it('all built-in presets carry every schema key (no built-in goes stale silently)', () => {
    const requiredLayerKeys = Object.keys(CURRENT_LAYERS) as (keyof LayerVisibility)[]
    const requiredOpacityKeys = Object.keys(CURRENT_OPACITIES) as (keyof LayerOpacity)[]
    for (const preset of BUILT_IN_PRESETS) {
      for (const k of requiredLayerKeys) {
        expect(preset.layers[k], `${preset.id} missing layers.${k}`).toBeDefined()
      }
      for (const k of requiredOpacityKeys) {
        expect(preset.opacities[k], `${preset.id} missing opacities.${k}`).toBeDefined()
      }
    }
  })
})

describe('loadCustomPresets — corrupt localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns [] when storage is empty', () => {
    expect(loadCustomPresets()).toEqual([])
  })

  it('returns [] when storage holds invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadCustomPresets()).toEqual([])
  })

  it('returns [] when storage holds a non-array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'x' }))
    expect(loadCustomPresets()).toEqual([])
  })

  it('filters out malformed entries (missing layers/opacities/id/name)', () => {
    const mixed = [
      { id: 'good', name: 'Good', layers: { terrain_cell: true }, opacities: { terrain_cell: 1 } },
      { id: 'no-layers', name: 'Bad' }, // missing layers + opacities
      { name: 'no-id', layers: {}, opacities: {} }, // missing id
      { id: 'no-name', layers: {}, opacities: {} }, // missing name
      null,
      'string-not-object',
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed))
    const out = loadCustomPresets()
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('good')
  })
})
