import { migrateCampaign } from './campaign-schema'
import { CAMPAIGN_SECTIONS, type ImportMode } from './section-registry'

/**
 * Validate and apply a campaign file to local storage.
 * `replace` (Open) applies content + preferences; `merge` (Import) applies content only
 * (machine-local preferences are left untouched). Throws a human-readable Error on a
 * malformed file (via migrateCampaign) — the caller surfaces it.
 */
export function importCampaign(json: unknown, mode: ImportMode): void {
  const env = migrateCampaign(json)
  for (const section of CAMPAIGN_SECTIONS) {
    if (mode === 'merge' && section.scope === 'preference') continue
    const bucket = section.scope === 'content' ? env.content : env.preferences
    if (!bucket || !(section.id in bucket)) continue
    const value = bucket[section.id]
    if (value === undefined) continue
    section.write(value, mode)
  }
}
