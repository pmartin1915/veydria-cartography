import L from 'leaflet'
import { worldScale } from './world-coords'

/**
 * Pick the largest 1/2/5×10ⁿ km step whose on-screen width stays within
 * `targetPx` at the current resolution.
 */
export function niceScaleStep(kmPerPixel: number, targetPx: number): number {
  if (!Number.isFinite(kmPerPixel) || kmPerPixel <= 0 || !Number.isFinite(targetPx) || targetPx <= 0) {
    return 0
  }
  const maxKm = targetPx * kmPerPixel
  const exponent = Math.floor(Math.log10(maxKm))
  const base = 10 ** exponent
  const factors = [1, 2, 5] as const
  let best = base
  for (const f of factors) {
    const step = f * base
    if (step / kmPerPixel <= targetPx) {
      best = step
    }
  }
  return best
}

export interface ScaleControl {
  destroy: () => void
}

export function initScaleControl(map: L.Map): ScaleControl {
  let container: HTMLElement | null = null
  let bar: HTMLElement | null = null
  let label: HTMLElement | null = null

  const update = () => {
    if (!container || !bar || !label || !map) return
    // Wide-span probe: latLngToLayerPoint rounds to integers, so a 1-unit
    // probe quantizes the scale at fractional zoom levels (1.414 → 1).
    const SPAN = 1200
    const p00 = map.latLngToLayerPoint(L.latLng(0, 0))
    const p10 = map.latLngToLayerPoint(L.latLng(0, SPAN))
    const pxPerSvg = (p10.x - p00.x) / SPAN
    if (!pxPerSvg) return

    const kmPerPixel = worldScale.kmPerSvgUnit / pxPerSvg
    const stepKm = niceScaleStep(kmPerPixel, 120)
    const widthPx = stepKm / kmPerPixel
    bar.style.width = `${widthPx}px`
    label.textContent = `${stepKm} km`
  }

  const ScaleBar = L.Control.extend({
    options: {
      position: 'bottomright',
    },
    onAdd() {
      container = L.DomUtil.create('div', 'map-scale-bar')
      label = L.DomUtil.create('div', 'map-scale-bar-label', container)
      bar = L.DomUtil.create('div', 'map-scale-bar-line', container)
      // The control is added before the map's initial setView/fitBounds;
      // latLngToLayerPoint throws until then. whenReady defers to first load.
      map.whenReady(update)
      return container
    },
  })

  const control = new ScaleBar()
  control.addTo(map)
  map.on('zoomend moveend', update)

  return {
    destroy() {
      map.off('zoomend moveend', update)
      map.removeControl(control)
      container = null
      bar = null
      label = null
    },
  }
}
