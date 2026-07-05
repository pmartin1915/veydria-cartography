import { describe, expect, it } from 'vitest'
import { buildHash, buildShareUrl, parseHash } from './url-hash'

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

    it('parses #hexNote=G7 as hex deep-link', () => {
      const state = parseHash('#hexNote=G7')
      expect(state.hexNote).toBe('G7')
    })

    it('builds a hash with hexNote', () => {
      expect(buildHash({ hexNote: 'G7' })).toBe('#hexNote=G7')
    })

    it('round-trips hexNote alongside zoom/center', () => {
      const original = { hexNote: 'B3', zoom: 1.5, centerX: 600, centerY: 400 }
      const hash = buildHash(original)
      const parsed = parseHash(hash)
      expect(parsed.hexNote).toBe('B3')
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

  describe('buildShareUrl', () => {
    it('returns baseUrl + hash when baseUrl is provided', () => {
      const url = buildShareUrl(
        { featureId: 'f1', zoom: 1.5, centerX: 600, centerY: 400 },
        'https://example.com/map'
      )
      expect(url).toBe('https://example.com/map#feature=f1&z=1.50&cx=600.0&cy=400.0')
    })

    it('returns only hash in node environment when baseUrl is omitted', () => {
      const url = buildShareUrl({ hexLabel: 'G7' })
      expect(url).toBe('#hex=G7')
    })

    it('includes share=1 for player view', () => {
      const url = buildShareUrl(
        { featureId: 'f1', share: true },
        'https://example.com/map'
      )
      expect(url).toBe('https://example.com/map#feature=f1&share=1')
    })

    it('composes all parameters into a single URL', () => {
      const state = {
        featureId: 'f1',
        hexLabel: 'G7',
        hexA: 'A1',
        hexB: 'B3',
        journeyFrom: 'Ki-Mbuhari',
        journeyTo: 'Tavakh-Qarat',
        zoom: 2.5,
        centerX: 300,
        centerY: 200,
      }
      const url = buildShareUrl(state, 'https://example.com/map')
      const hashStart = url.indexOf('#')
      expect(hashStart).toBeGreaterThan(-1)
      const hash = url.slice(hashStart)
      const parsed = parseHash(hash)
      expect(parsed.featureId).toBe('f1')
      expect(parsed.hexLabel).toBe('G7')
      expect(parsed.hexA).toBe('A1')
      expect(parsed.hexB).toBe('B3')
      expect(parsed.journeyFrom).toBe('Ki-Mbuhari')
      expect(parsed.journeyTo).toBe('Tavakh-Qarat')
      expect(parsed.zoom).toBe(2.5)
      expect(parsed.centerX).toBe(300)
      expect(parsed.centerY).toBe(200)
    })

    it('returns baseUrl unchanged when state is empty', () => {
      const url = buildShareUrl({}, 'https://example.com/map')
      expect(url).toBe('https://example.com/map')
    })

    it('round-trips through parseHash correctly', () => {
      const original = {
        hexLabel: 'AA12',
        zoom: -1.25,
        centerX: 0,
        centerY: 800,
      }
      const url = buildShareUrl(original, 'https://example.com/map')
      const hash = url.slice(url.indexOf('#'))
      const parsed = parseHash(hash)
      expect(parsed.hexLabel).toBe('AA12')
      expect(parsed.zoom).toBe(-1.25)
      expect(parsed.centerX).toBe(0)
      expect(parsed.centerY).toBe(800)
    })
  })

  describe('planner season + mode', () => {
    it('round-trips season=summer', () => {
      const hash = buildHash({ season: 'summer' })
      expect(hash).toContain('season=summer')
      expect(parseHash(hash).season).toBe('summer')
    })

    it('round-trips mode=safest', () => {
      const hash = buildHash({ mode: 'safest' })
      expect(hash).toContain('mode=safest')
      expect(parseHash(hash).mode).toBe('safest')
    })

    it('omits mode=direct (default)', () => {
      expect(buildHash({ mode: 'direct' })).not.toContain('mode')
    })

    it('omits season when undefined', () => {
      expect(buildHash({})).not.toContain('season')
    })

    it('rejects unknown season/mode values', () => {
      expect(parseHash('#season=monsoon').season).toBeUndefined()
      expect(parseHash('#mode=teleport').mode).toBeUndefined()
    })

    it('round-trips season + mode + journey endpoints together', () => {
      const original = {
        journeyFrom: 'tavakh_qarat',
        journeyTo: 'tavakh_rubat',
        season: 'autumn' as const,
        mode: 'safest' as const,
      }
      const parsed = parseHash(buildHash(original))
      expect(parsed.journeyFrom).toBe('tavakh_qarat')
      expect(parsed.journeyTo).toBe('tavakh_rubat')
      expect(parsed.season).toBe('autumn')
      expect(parsed.mode).toBe('safest')
    })
  })

  describe('fog of war', () => {
    it('round-trips fog=1', () => {
      const hash = buildHash({ share: true, fog: true })
      expect(hash).toContain('fog=1')
      const parsed = parseHash(hash)
      expect(parsed.fog).toBe(true)
    })

    it('omits fog when false or undefined', () => {
      expect(buildHash({ share: true })).not.toContain('fog')
      expect(buildHash({ fog: false })).not.toContain('fog')
    })

    it('parseHash without fog leaves it undefined', () => {
      const parsed = parseHash('#share=1')
      expect(parsed.share).toBe(true)
      expect(parsed.fog).toBeUndefined()
    })
  })

  describe('active party (Tier 2c)', () => {
    it('round-trips a non-default party name', () => {
      const hash = buildHash({ party: 'Scouts' })
      expect(hash).toContain('party=Scouts')
      expect(parseHash(hash).party).toBe('Scouts')
    })

    it('omits the default "Main party"', () => {
      expect(buildHash({ party: 'Main party' })).not.toContain('party=')
    })

    it('omits empty / whitespace-only names', () => {
      expect(buildHash({ party: '' })).not.toContain('party=')
      expect(buildHash({ party: '   ' })).not.toContain('party=')
    })

    it('trims and length-caps on both build and parse', () => {
      expect(parseHash('#party=%20%20Baggage%20train%20%20').party).toBe('Baggage train')
      expect(parseHash(`#party=${'x'.repeat(80)}`).party).toHaveLength(60)
    })

    it('parseHash without party leaves it undefined', () => {
      expect(parseHash('#share=1').party).toBeUndefined()
    })
  })

  describe('trail seed (dev/debug)', () => {
    it('round-trips an explicit seed', () => {
      const hash = buildHash({ trailSeed: 42 })
      expect(hash).toContain('trailSeed=42')
      expect(parseHash(hash).trailSeed).toBe(42)
    })

    it('accepts the uint32 bounds', () => {
      expect(parseHash('#trailSeed=0').trailSeed).toBe(0)
      expect(parseHash('#trailSeed=4294967295').trailSeed).toBe(0xffffffff)
    })

    it('drops non-integer, negative, out-of-range, and malformed values', () => {
      expect(parseHash('#trailSeed=1.5').trailSeed).toBeUndefined()
      expect(parseHash('#trailSeed=-1').trailSeed).toBeUndefined()
      expect(parseHash('#trailSeed=4294967296').trailSeed).toBeUndefined()
      expect(parseHash('#trailSeed=abc').trailSeed).toBeUndefined()
    })

    it('is omitted from the hash when unset', () => {
      expect(buildHash({ journeyFrom: 'irrah' })).not.toContain('trailSeed')
      expect(parseHash('#journeyFrom=irrah').trailSeed).toBeUndefined()
    })
  })
})
