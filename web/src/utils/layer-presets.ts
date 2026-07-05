/**
 * layer-presets.ts — Named snapshots of layer visibility + opacity.
 *
 * Built-in presets cover the common GM views (trade, politics, terrain,
 * player-facing). Custom presets are persisted to localStorage so a GM
 * can save their own working sets.
 */

import { kvStore } from '../persistence/kv-store'
import type { LayerVisibility, LayerOpacity } from '../App'

export interface LayerPreset {
  id: string
  name: string
  layers: LayerVisibility
  opacities: LayerOpacity
  builtIn?: boolean
}

const ALL_OFF: LayerVisibility = {
  terrain_cell: false,
  civilization: false,
  water: false,
  chokepoint: false,
  port: false,
  oasis: false,
  contested_site: false,
  hex_grid: false,
  graticule: false,
  trade_route: false,
  landmark: false,
  river: false,
  faction_control: false,
  terrain_cost: false,
  biome_colors: false,
  explored: false,
  marginalia: false,
}

const FULL_OPACITY: LayerOpacity = {
  terrain_cell: 0.85,
  civilization: 0.15,
  water: 0.5,
  chokepoint: 1,
  port: 1,
  oasis: 1,
  contested_site: 1,
  hex_grid: 0.7,
  graticule: 0.7,
  trade_route: 0.75,
  landmark: 1,
  river: 0.6,
  faction_control: 1,
  terrain_cost: 0.75,
  biome_colors: 1,
  explored: 1,
  marginalia: 1,
}

export const BUILT_IN_PRESETS: LayerPreset[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    layers: {
      terrain_cell: true,
      civilization: true,
      water: true,
      chokepoint: true,
      port: true,
      oasis: true,
      contested_site: true,
      hex_grid: false,
      graticule: false,
      trade_route: true,
      landmark: true,
      river: true,
      faction_control: false,
      terrain_cost: false,
      biome_colors: false,
      explored: false,
      marginalia: true,
    },
    opacities: { ...FULL_OPACITY },
  },
  {
    id: 'trade',
    name: 'Trade view',
    builtIn: true,
    layers: {
      ...ALL_OFF,
      water: true,
      civilization: true,
      port: true,
      chokepoint: true,
      trade_route: true,
      river: true,
    },
    opacities: { ...FULL_OPACITY, civilization: 0.08, water: 0.4 },
  },
  {
    id: 'politics',
    name: 'Politics view',
    builtIn: true,
    layers: {
      ...ALL_OFF,
      terrain_cell: true,
      civilization: true,
      water: true,
      contested_site: true,
      faction_control: true,
    },
    opacities: { ...FULL_OPACITY, terrain_cell: 0.7, civilization: 0.2 },
  },
  {
    id: 'geography',
    name: 'Geography only',
    builtIn: true,
    layers: {
      ...ALL_OFF,
      terrain_cell: true,
      water: true,
      river: true,
      oasis: true,
      landmark: true,
    },
    opacities: { ...FULL_OPACITY, terrain_cell: 0.95 },
  },
  {
    id: 'terrain-cost',
    name: 'Terrain cost',
    builtIn: true,
    layers: {
      ...ALL_OFF,
      terrain_cell: true,
      water: true,
      port: true,
      chokepoint: true,
      terrain_cost: true,
    },
    opacities: { ...FULL_OPACITY, terrain_cell: 0.9 },
  },
  {
    id: 'tactical',
    name: 'Tactical',
    builtIn: true,
    layers: {
      ...ALL_OFF,
      terrain_cell: true,
      water: true,
      river: true,
      port: true,
      oasis: true,
      chokepoint: true,
      landmark: true,
      hex_grid: true,
      graticule: false,
    },
    // Dim terrain so the hex grid reads as the primary structure.
    opacities: { ...FULL_OPACITY, terrain_cell: 0.3, water: 0.4, hex_grid: 0.9 },
  },
  {
    id: 'player',
    name: 'Player-facing',
    builtIn: true,
    layers: {
      terrain_cell: true,
      civilization: true,
      water: true,
      chokepoint: true,
      port: true,
      oasis: true,
      contested_site: true,
      hex_grid: false,
      graticule: false,
      trade_route: true,
      landmark: true,
      river: true,
      faction_control: false,
      terrain_cost: false,
      biome_colors: false,
      explored: false,
      marginalia: true,
    },
    opacities: { ...FULL_OPACITY },
  },
]

const STORAGE_KEY = 'veydria.layer.presets.v1'

export function loadCustomPresets(): LayerPreset[] {
  try {
    const raw = kvStore.getString(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LayerPreset[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.layers && p.opacities)
  } catch {
    return []
  }
}

export function saveCustomPresets(presets: LayerPreset[]): void {
  try {
    kvStore.setString(STORAGE_KEY, JSON.stringify(presets.filter(p => !p.builtIn)))
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
