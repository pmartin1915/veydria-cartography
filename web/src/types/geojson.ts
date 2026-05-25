/**
 * Shared GeoJSON shapes. Lives outside App.tsx so node-side scripts
 * (e.g. scripts/sim/*) can import these types without dragging the
 * React component tree through vite-node.
 */

export interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

export interface GeoJSONCollection {
  type: 'FeatureCollection'
  metadata?: Record<string, unknown>
  features: GeoJSONFeature[]
}
