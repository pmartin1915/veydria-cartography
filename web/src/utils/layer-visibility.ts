import type L from 'leaflet'

// Some "layers" in MapViewer aren't real Leaflet LayerGroups — they're plain
// dicts that imitate the addTo/removeFrom/setOpacity shape but proxy to a
// hand-rolled D3/SVG overlay underneath. The toggle dispatcher needs to
// distinguish them so it doesn't try to call Leaflet's hasLayer/removeLayer
// on something Leaflet has never registered.
export interface OverlayMock {
  addTo: (map?: L.Map) => void
  removeFrom: (map?: L.Map) => void
  setOpacity: (o: number) => void
  __mock: true
}

export type LayerEntry = L.LayerGroup | OverlayMock

export function isOverlayMock(entry: LayerEntry): entry is OverlayMock {
  return (entry as OverlayMock).__mock === true
}

export function applyLayerVisibility(
  entry: LayerEntry,
  visible: boolean,
  map: L.Map,
): void {
  if (isOverlayMock(entry)) {
    if (visible) entry.addTo(map)
    else entry.removeFrom(map)
    return
  }
  if (visible && !map.hasLayer(entry)) {
    entry.addTo(map)
  } else if (!visible && map.hasLayer(entry)) {
    map.removeLayer(entry)
  }
}
