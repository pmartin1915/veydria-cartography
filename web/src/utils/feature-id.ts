import type { GeoJSONFeature } from '../App'

/**
 * Canonical identity of a feature for every consumer that keys on feature
 * IDs (lore lookup, highlights, notes, pins, search, stars). Multi-part
 * trade routes are emitted as one feature per part — part 1 keeps the route
 * ID, parts 2+ are id'd `<route>__p<n>` — so `route_id` (present only on
 * parts) resolves back to the parent route and the parts behave as one
 * route everywhere.
 */
export function featureIdOf(f: GeoJSONFeature): string {
  return (f.properties.route_id as string)
    || ((f as unknown as Record<string, unknown>).id as string)
    || (f.properties.id as string)
    || ''
}
