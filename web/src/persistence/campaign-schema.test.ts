import { describe, it, expect } from 'vitest'
import { migrateCampaign, type CampaignEnvelope } from './campaign-schema'

const VALID_ENVELOPE: CampaignEnvelope = {
  schema: 'veydria-campaign',
  version: 1,
  savedAt: 0,
  content: {},
}

describe('migrateCampaign', () => {
  it('accepts a valid envelope', () => {
    expect(migrateCampaign(VALID_ENVELOPE)).toEqual(VALID_ENVELOPE)
  })

  it('rejects version 2', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, version: 2 })).toThrow()
  })

  it('rejects version 0', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, version: 0 })).toThrow()
  })

  it('rejects missing version', () => {
    const { version: _version, ...rest } = VALID_ENVELOPE
    expect(() => migrateCampaign(rest)).toThrow()
  })

  it('rejects non-numeric version', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, version: '1' as unknown as number })).toThrow()
  })

  it('rejects wrong schema', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, schema: 'other' })).toThrow()
  })

  it('rejects missing schema', () => {
    const { schema: _schema, ...rest } = VALID_ENVELOPE
    expect(() => migrateCampaign(rest)).toThrow()
  })

  it('rejects non-number savedAt', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, savedAt: 'now' as unknown as number })).toThrow()
  })

  it('rejects missing savedAt', () => {
    const { savedAt: _savedAt, ...rest } = VALID_ENVELOPE
    expect(() => migrateCampaign(rest)).toThrow()
  })

  it('rejects content that is not an object', () => {
    expect(() => migrateCampaign({ ...VALID_ENVELOPE, content: [] as unknown as Record<string, unknown> })).toThrow()
  })

  it('rejects missing content', () => {
    const { content: _content, ...rest } = VALID_ENVELOPE
    expect(() => migrateCampaign(rest)).toThrow()
  })

  it('rejects null input', () => {
    expect(() => migrateCampaign(null)).toThrow()
  })

  it('rejects string input', () => {
    expect(() => migrateCampaign('not an object')).toThrow()
  })
})
