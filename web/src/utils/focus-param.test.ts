import { describe, expect, it } from 'vitest'
import { focusToFeatureId, parseFocusParam, rewriteFocusToHash } from './focus-param'

describe('focus-param', () => {
  describe('parseFocusParam', () => {
    it('parses ?focus=region:irrah', () => {
      expect(parseFocusParam('?focus=region:irrah')).toEqual({ kind: 'region', slug: 'irrah' })
    })

    it('parses without leading ?', () => {
      expect(parseFocusParam('focus=port:halani-tamu')).toEqual({ kind: 'port', slug: 'halani-tamu' })
    })

    it('accepts kebab-case slugs with multiple hyphens', () => {
      expect(parseFocusParam('?focus=region:ngaru-bon')).toEqual({ kind: 'region', slug: 'ngaru-bon' })
      expect(parseFocusParam('?focus=sacred-site:veyd-kirrha')).toEqual({ kind: 'sacred-site', slug: 'veyd-kirrha' })
    })

    it('returns null for empty / missing param', () => {
      expect(parseFocusParam('')).toBeNull()
      expect(parseFocusParam('?other=x')).toBeNull()
    })

    it('returns null for malformed value (no colon, empty slug, empty kind)', () => {
      expect(parseFocusParam('?focus=region')).toBeNull()
      expect(parseFocusParam('?focus=region:')).toBeNull()
      expect(parseFocusParam('?focus=:irrah')).toBeNull()
    })

    it('returns null for kinds not rendered on the hex grid', () => {
      // Worldbuilder emits links only for kinds the hex grid renders, but
      // belt-and-braces: drop unsupported kinds silently.
      expect(parseFocusParam('?focus=magic-register:irrah')).toBeNull()
      expect(parseFocusParam('?focus=ruin:garamantes-shadow')).toBeNull()
      expect(parseFocusParam('?focus=mountain:zang-ri')).toBeNull()
    })

    it('rejects slugs with disallowed characters (defense against URL-injection)', () => {
      expect(parseFocusParam('?focus=region:irrah/etc')).toBeNull()
      expect(parseFocusParam('?focus=region:IRRAH')).toBeNull()
      expect(parseFocusParam('?focus=region:irrah%20kheshkai')).toBeNull()
    })
  })

  describe('focusToFeatureId', () => {
    it('translates kebab slug to snake_case feature id', () => {
      expect(focusToFeatureId('region', 'ngaru-bon')).toBe('ngaru_bon')
      expect(focusToFeatureId('port', 'halani-tamu')).toBe('halani_tamu')
      expect(focusToFeatureId('sacred-site', 'veyd-kirrha')).toBe('veyd_kirrha')
      expect(focusToFeatureId('chokepoint', 'smith-spring')).toBe('smith_spring')
      expect(focusToFeatureId('oasis', 'qarat-al-fidda')).toBe('qarat_al_fidda')
    })

    it('passes single-token slugs through unchanged', () => {
      expect(focusToFeatureId('region', 'irrah')).toBe('irrah')
    })

    it('returns null for unsupported kinds', () => {
      expect(focusToFeatureId('magic-register', 'irrah')).toBeNull()
    })
  })

  describe('rewriteFocusToHash', () => {
    it('returns null with no focus param at all (no rewrite needed)', () => {
      expect(rewriteFocusToHash('', '')).toBeNull()
      expect(rewriteFocusToHash('?other=x', '#z=1.5')).toBeNull()
    })

    it('rewrites ?focus=region:irrah into a feature= hash entry', () => {
      const result = rewriteFocusToHash('?focus=region:irrah', '')
      expect(result).toMatchObject({ featureId: 'irrah', newHash: 'feature=irrah', shouldRewrite: true, newSearch: '' })
    })

    it('merges into existing hash params, preserving them', () => {
      const result = rewriteFocusToHash('?focus=port:halani-tamu', '#z=1.5&cx=600')
      expect(result?.featureId).toBe('halani_tamu')
      const params = new URLSearchParams(result!.newHash)
      expect(params.get('feature')).toBe('halani_tamu')
      expect(params.get('z')).toBe('1.5')
      expect(params.get('cx')).toBe('600')
    })

    it('overrides any pre-existing feature= in the hash', () => {
      const result = rewriteFocusToHash('?focus=region:kheshkai', '#feature=stale&z=1')
      expect(result?.featureId).toBe('kheshkai')
      const params = new URLSearchParams(result!.newHash)
      expect(params.get('feature')).toBe('kheshkai')
      expect(params.get('z')).toBe('1')
    })

    it('rejected ?focus= still triggers a rewrite that strips the param', () => {
      const result = rewriteFocusToHash('?focus=magic-register:irrah', '#z=1.5')
      expect(result).not.toBeNull()
      expect(result?.featureId).toBeNull()
      expect(result?.shouldRewrite).toBe(true)
      expect(result?.newSearch).toBe('')
      // Hash is untouched on rejection (no feature= injected).
      expect(result?.newHash).toBe('z=1.5')
    })

    it('rejected ?focus= preserves any sibling query params', () => {
      const result = rewriteFocusToHash('?focus=:irrah&utm=campaign', '')
      expect(result?.featureId).toBeNull()
      expect(result?.newSearch).toBe('?utm=campaign')
      expect(result?.newHash).toBe('')
    })
  })
})
