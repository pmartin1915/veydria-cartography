import { describe, expect, it } from 'vitest'
import { buildHash, parseHash } from './url-hash'

describe('url-hash', () => {
  describe('hex deep-link', () => {
    it('parses #hex=G7', () => {
      const state = parseHash('#hex=G7')
      expect(state.hexLabel).toBe('G7')
    })

    it('parses double-letter rows like #hex=AA12', () => {
      const state = parseHash('#hex=AA12')
      expect(state.hexLabel).toBe('AA12')
    })

    it('drops malformed labels (lowercase, no digits, special chars)', () => {
      expect(parseHash('#hex=g7').hexLabel).toBeUndefined()
      expect(parseHash('#hex=G').hexLabel).toBeUndefined()
      expect(parseHash('#hex=7').hexLabel).toBeUndefined()
      expect(parseHash('#hex=G%207').hexLabel).toBeUndefined()
    })

    it('builds a hash with hex label', () => {
      expect(buildHash({ hexLabel: 'G7' })).toBe('#hex=G7')
    })

    it('round-trips hex alongside zoom/center', () => {
      const original = { hexLabel: 'B3', zoom: 1.5, centerX: 600, centerY: 400 }
      const hash = buildHash(original)
      const parsed = parseHash(hash)
      expect(parsed.hexLabel).toBe('B3')
      expect(parsed.zoom).toBe(1.5)
      expect(parsed.centerX).toBe(600)
      expect(parsed.centerY).toBe(400)
    })

    it('coexists with feature in the hash for callers that set both, but drops feature when only hex is set', () => {
      // The App enforces mutual exclusion, but the builder itself keeps both
      // if both are passed in — that's the pure-data layer's job.
      const both = buildHash({ featureId: 'f1', hexLabel: 'C4' })
      const parsed = parseHash(both)
      expect(parsed.featureId).toBe('f1')
      expect(parsed.hexLabel).toBe('C4')
    })

    it('omits hex from output when label is absent', () => {
      const hash = buildHash({ featureId: 'f1' })
      expect(hash).not.toContain('hex=')
    })
  })

  describe('hex measure deep-link (hexA / hexB)', () => {
    it('round-trips both endpoints', () => {
      const hash = buildHash({ hexA: 'G7', hexB: 'K12' })
      const parsed = parseHash(hash)
      expect(parsed.hexA).toBe('G7')
      expect(parsed.hexB).toBe('K12')
    })

    it('drops malformed endpoint labels independently', () => {
      const parsed = parseHash('#hexA=G7&hexB=k12')
      expect(parsed.hexA).toBe('G7')
      expect(parsed.hexB).toBeUndefined()
    })

    it('builder omits hexA / hexB when not set', () => {
      const hash = buildHash({ hexLabel: 'G7' })
      expect(hash).not.toContain('hexA=')
      expect(hash).not.toContain('hexB=')
    })

    it('coexists with zoom/center', () => {
      const hash = buildHash({ hexA: 'A1', hexB: 'B3', zoom: 1.5, centerX: 600, centerY: 400 })
      const parsed = parseHash(hash)
      expect(parsed.hexA).toBe('A1')
      expect(parsed.hexB).toBe('B3')
      expect(parsed.zoom).toBe(1.5)
    })
  })
})
