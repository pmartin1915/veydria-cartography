// Shared map-style constants — single source of truth for the marker glyphs,
// civ colors, and elevation gradient used both by the live map render
// (MapViewer) and the on-map key (MapKey), so the legend can never drift from
// what's actually drawn. Kept in a leaf module to avoid a MapViewer↔MapKey cycle.

// SVG marker icons per point-feature category (raw markup for Leaflet divIcons).
export const MARKER_SVGS: Record<string, string> = {
  port: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 21V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 12l4-3 4 3"/></svg>`,
  chokepoint: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M10 9.5a2 2 0 0 1 4 0V21"/></svg>`,
  oasis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-8"/><path d="M12 14c-2-2-4-5-4-8a4 4 0 0 1 8 0c0 3-2 6-4 8z"/><path d="M8 22h8"/></svg>`,
  contested_site: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  landmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 12 12 22 2 12 12 2"/></svg>`,
}

export const MARKER_CLASSES: Record<string, string> = {
  port: 'marker-port',
  chokepoint: 'marker-chokepoint',
  oasis: 'marker-oasis',
  contested_site: 'marker-contested',
  landmark: 'marker-landmark',
}

export const CIV_COLORS: Record<string, string> = {
  ngaru_bon: '#9a8a7a',
  irrah: '#b8a060',
  kheshkai: '#8a9a5a',
  ndjadi: '#5a9a6a',
  qollari: '#4a8a7a',
  oravan: '#4a7a9a',
}

// Elevation gradient stops — shared by the terrain fill (`getElevationColor` in
// MapViewer) and the map-key legend. Ordered low→high; `max` is the exclusive
// upper bound on the normalized elevation value.
export const ELEVATION_STOPS: { color: string; label: string; max: number }[] = [
  { color: '#8ab87a', label: 'Lowland', max: 0.4 },
  { color: '#c8d4a0', label: 'Upland', max: 0.6 },
  { color: '#e8d5a0', label: 'Highland', max: 0.8 },
  { color: '#c9b896', label: 'Plateau', max: 0.9 },
  { color: '#f5f5f5', label: 'Peak', max: Infinity },
]
