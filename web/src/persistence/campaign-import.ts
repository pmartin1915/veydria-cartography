import { migrateCampaign } from './campaign-schema'
import { CAMPAIGN_SECTIONS, type ImportMode } from './section-registry'
import {
  transformCampaignContent,
  type LayoutTransformContext,
} from './map-layout-migration'

/**
 * Validate and apply a campaign file to local storage.
 * `replace` (Open) applies content + preferences; `merge` (Import) applies content only
 * (machine-local preferences are left untouched). Throws a human-readable Error on a
 * malformed file (via migrateCampaign) — the caller surfaces it.
 *
 * Version 1 files were exported on the pre-Phase-1 (April) map layout. When the
 * caller supplies a `layoutCtx`, the v1 content runs the same layout transform
 * as the local boot migration (pins re-anchored or flagged, journeys recomputed
 * or marked stale) before it is saved. The app always builds the context from
 * the loaded geojson; without it the content is saved untransformed.
 */
export function importCampaign(
  json: unknown,
  mode: ImportMode,
  layoutCtx?: LayoutTransformContext,
): void {
  const env = migrateCampaign(json)
  if (env.version === 1 && layoutCtx) {
    env.content = transformCampaignContent(env.content, layoutCtx)
  }
  for (const section of CAMPAIGN_SECTIONS) {
    if (mode === 'merge' && section.scope === 'preference') continue
    const bucket = section.scope === 'content' ? env.content : env.preferences
    if (!bucket || !(section.id in bucket)) continue
    const value = bucket[section.id]
    if (value === undefined) continue
    section.write(value, mode)
  }
}
