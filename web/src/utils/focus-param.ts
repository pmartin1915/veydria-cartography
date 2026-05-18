/**
 * focus-param.ts — Inbound `?focus=<kind>:<slug>` handler.
 *
 * Translates the deep-link URL form emitted by the worldbuilder map-viewer
 * (`${cartography-base}/?focus=<kind>:<slug>`) into a cartography feature ID,
 * suitable for splicing into the existing `#feature=<id>` hash flow.
 *
 * Slug → feature-id rule: kebab → snake (`ngaru-bon` → `ngaru_bon`).
 * Kind → category rule: identity for most kinds; `region` → `civilization`,
 * `sacred-site` → `contested_site`. Kinds the cartography hex grid does not
 * render return null and the param is dropped silently — the user still lands
 * on cartography, just without focus.
 *
 * See worldbuilder/tools/map-viewer/src/utils/cartography-link.js for the
 * outbound emitter.
 */

export interface FocusParam {
  kind: string
  slug: string
}

const SUPPORTED_KINDS = new Set(['region', 'port', 'chokepoint', 'oasis', 'sacred-site'])

export function parseFocusParam(search: string): FocusParam | null {
  if (!search) return null
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const raw = params.get('focus')
  if (!raw) return null
  const colon = raw.indexOf(':')
  if (colon <= 0 || colon === raw.length - 1) return null
  const kind = raw.slice(0, colon)
  const slug = raw.slice(colon + 1)
  if (!SUPPORTED_KINDS.has(kind)) return null
  if (!/^[a-z0-9-]+$/.test(slug)) return null
  return { kind, slug }
}

export function focusToFeatureId(kind: string, slug: string): string | null {
  if (!SUPPORTED_KINDS.has(kind)) return null
  return slug.replace(/-/g, '_')
}

export interface FocusRewrite {
  /** The resolved feature id, or null when the focus param was rejected. */
  featureId: string | null
  /** New hash body (no leading `#`). Empty string means no hash. */
  newHash: string
  /** Whether the URL needs rewriting (i.e. `?focus=` was present in `search`). */
  shouldRewrite: boolean
}

function searchHasFocusParam(search: string): boolean {
  if (!search) return false
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.has('focus')
}

function stripFocusFromSearch(search: string): string {
  if (!search) return ''
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete('focus')
  const str = params.toString()
  return str ? `?${str}` : ''
}

/**
 * Pure URL-rewriter: given the page's `search` and `hash`, decide what the
 * URL should become.
 *
 * - No `?focus=` at all → returns null (nothing to do).
 * - `?focus=` present and valid → `featureId` set, merged into hash params.
 * - `?focus=` present but rejected (bad kind/slug) → `featureId` null, hash
 *   left alone, but the param is still stripped so the URL is hygienic.
 *
 * In both present-cases `shouldRewrite` is true; non-focus query params (if
 * any) are preserved and returned in `newSearch`.
 */
export function rewriteFocusToHash(search: string, hash: string): (FocusRewrite & { newSearch: string }) | null {
  if (!searchHasFocusParam(search)) return null
  const newSearch = stripFocusFromSearch(search)
  const parsed = parseFocusParam(search)
  const featureId = parsed ? focusToFeatureId(parsed.kind, parsed.slug) : null
  const existingHash = hash.startsWith('#') ? hash.slice(1) : hash
  const hashParams = new URLSearchParams(existingHash)
  if (featureId) hashParams.set('feature', featureId)
  return {
    featureId,
    newHash: hashParams.toString(),
    shouldRewrite: true,
    newSearch,
  }
}

/**
 * One-shot URL rewriter: read `window.location.search` for `?focus=...`,
 * translate to `#feature=<id>` via {@link rewriteFocusToHash}, and rewrite
 * the URL via replaceState. Returns the resolved feature id (or null if no
 * focus param / unsupported kind). Idempotent: subsequent calls see no
 * `?focus=` and do nothing.
 *
 * The `?focus=` param is always stripped when present — even when the value
 * is rejected (unsupported kind, malformed slug) — so the URL never carries
 * a contractually-defined param that the app deliberately ignored.
 *
 * Designed to run before `parseHash(window.location.hash)` is captured so
 * the existing deep-link flow (fly-to + select) picks up the spliced hash.
 */
export function consumeFocusParam(): string | null {
  if (typeof window === 'undefined') return null
  const rewrite = rewriteFocusToHash(window.location.search, window.location.hash)
  if (!rewrite) return null
  const newUrl = window.location.pathname + rewrite.newSearch + (rewrite.newHash ? `#${rewrite.newHash}` : '')
  window.history.replaceState(null, '', newUrl)
  return rewrite.featureId
}
