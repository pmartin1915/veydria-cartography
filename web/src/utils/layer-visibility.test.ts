import { describe, expect, it, vi } from 'vitest'
import type L from 'leaflet'
import {
  applyLayerVisibility,
  isOverlayMock,
  type LayerEntry,
  type OverlayMock,
} from './layer-visibility'

function makeMock(): OverlayMock & {
  addTo: ReturnType<typeof vi.fn>
  removeFrom: ReturnType<typeof vi.fn>
  setOpacity: ReturnType<typeof vi.fn>
} {
  return {
    addTo: vi.fn(),
    removeFrom: vi.fn(),
    setOpacity: vi.fn(),
    __mock: true,
  }
}

function makeFakeMap(hasLayerResult: boolean) {
  return {
    hasLayer: vi.fn(() => hasLayerResult),
    removeLayer: vi.fn(),
  }
}

function makeFakeLayerGroup(): { addTo: ReturnType<typeof vi.fn> } {
  // A plain object without __mock: looks like a LayerGroup to the dispatcher.
  return { addTo: vi.fn() }
}

describe('isOverlayMock', () => {
  it('returns true for objects with __mock: true', () => {
    expect(isOverlayMock(makeMock())).toBe(true)
  })

  it('returns false for objects without the discriminator', () => {
    expect(isOverlayMock(makeFakeLayerGroup() as unknown as LayerEntry)).toBe(false)
  })
})

describe('applyLayerVisibility — OverlayMock path', () => {
  // Regression: prior to the fix, hex_grid (and biome_colors) fell into the
  // LayerGroup branch and removeLayer() got called on a plain dict, so
  // setVisibility(false) was never invoked and the layer could not be
  // toggled OFF. These tests pin the dispatcher to the mock's addTo / removeFrom.
  it('calls addTo when visible=true', () => {
    const mock = makeMock()
    const map = makeFakeMap(false) as unknown as L.Map
    applyLayerVisibility(mock, true, map)
    expect(mock.addTo).toHaveBeenCalledTimes(1)
    expect(mock.removeFrom).not.toHaveBeenCalled()
  })

  it('calls removeFrom when visible=false', () => {
    const mock = makeMock()
    const map = makeFakeMap(false) as unknown as L.Map
    applyLayerVisibility(mock, false, map)
    expect(mock.removeFrom).toHaveBeenCalledTimes(1)
    expect(mock.addTo).not.toHaveBeenCalled()
  })

  it('does NOT call Leaflet hasLayer/removeLayer for mocks', () => {
    const mock = makeMock()
    const map = makeFakeMap(false)
    applyLayerVisibility(mock, false, map as unknown as L.Map)
    expect(map.hasLayer).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
  })
})

describe('applyLayerVisibility — real LayerGroup path', () => {
  it('addTo when visible=true and map does not yet have the layer', () => {
    const lg = makeFakeLayerGroup()
    const map = makeFakeMap(false)
    applyLayerVisibility(lg as unknown as LayerEntry, true, map as unknown as L.Map)
    expect(lg.addTo).toHaveBeenCalledTimes(1)
    expect(map.removeLayer).not.toHaveBeenCalled()
  })

  it('removeLayer when visible=false and map has the layer', () => {
    const lg = makeFakeLayerGroup()
    const map = makeFakeMap(true)
    applyLayerVisibility(lg as unknown as LayerEntry, false, map as unknown as L.Map)
    expect(map.removeLayer).toHaveBeenCalledTimes(1)
    expect(map.removeLayer).toHaveBeenCalledWith(lg)
    expect(lg.addTo).not.toHaveBeenCalled()
  })

  it('no-op when visible=true and map already has the layer', () => {
    const lg = makeFakeLayerGroup()
    const map = makeFakeMap(true)
    applyLayerVisibility(lg as unknown as LayerEntry, true, map as unknown as L.Map)
    expect(lg.addTo).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
  })

  it('no-op when visible=false and map does not have the layer', () => {
    const lg = makeFakeLayerGroup()
    const map = makeFakeMap(false)
    applyLayerVisibility(lg as unknown as LayerEntry, false, map as unknown as L.Map)
    expect(lg.addTo).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
  })
})
