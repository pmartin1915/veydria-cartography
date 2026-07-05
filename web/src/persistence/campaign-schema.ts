/**
 * campaign-schema.ts — Serializable campaign envelope and migration gate.
 *
 * Phase 4 defines the schema and the `migrateCampaign` read-side guard.
 * Import orchestration is Phase 5.
 */

export const CURRENT_CAMPAIGN_VERSION = 1

export interface CampaignEnvelope {
  schema: 'veydria-campaign'
  version: number
  savedAt: number
  content: Record<string, unknown>
  preferences?: Record<string, unknown>
}

/**
 * Validate that `json` is a readable campaign envelope.
 * Throws a human-readable message on any mismatch (surfaced in a Phase 5 toast).
 */
export function migrateCampaign(json: unknown): CampaignEnvelope {
  if (!json || typeof json !== 'object') {
    throw new Error('Campaign file is not a valid object.')
  }

  const envelope = json as Record<string, unknown>

  if (envelope.schema !== 'veydria-campaign') {
    throw new Error(`Unexpected campaign schema: ${String(envelope.schema)}.`)
  }

  if (envelope.version !== CURRENT_CAMPAIGN_VERSION) {
    throw new Error(`Unsupported campaign version: ${String(envelope.version)}.`)
  }

  if (typeof envelope.savedAt !== 'number') {
    throw new Error('Campaign envelope is missing a numeric savedAt timestamp.')
  }

  if (!envelope.content || typeof envelope.content !== 'object' || Array.isArray(envelope.content)) {
    throw new Error('Campaign envelope is missing a content object.')
  }

  return envelope as unknown as CampaignEnvelope
}
