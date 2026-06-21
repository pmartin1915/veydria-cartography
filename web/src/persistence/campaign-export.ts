/**
 * campaign-export.ts — Assemble a serializable campaign envelope from all registered sections.
 *
 * Phase 4 is export-only; no JSON.stringify, Blob, or download logic here.
 */

import { CAMPAIGN_SECTIONS } from './section-registry'
import { CURRENT_CAMPAIGN_VERSION, type CampaignEnvelope } from './campaign-schema'

export function exportCampaign(): CampaignEnvelope {
  const content: Record<string, unknown> = {}
  const preferences: Record<string, unknown> = {}

  for (const section of CAMPAIGN_SECTIONS) {
    const value = section.read()
    if (value === undefined) continue
    if (section.scope === 'content') {
      content[section.id] = value
    } else {
      preferences[section.id] = value
    }
  }

  const envelope: CampaignEnvelope = {
    schema: 'veydria-campaign',
    version: CURRENT_CAMPAIGN_VERSION,
    savedAt: Date.now(),
    content,
  }

  if (Object.keys(preferences).length > 0) {
    envelope.preferences = preferences
  }

  return envelope
}
