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
  featureId: string
  /** New hash body (no leading `#`). Empty string means no hash. */
  newHash: string
}

/**
 * Pure URL-rewriter: given the page's `search` and `hash`, return what the
 * spliced hash should become. Returns null if no actionable focus param.
 * The featureId is merged into any existing hash params (other params preserved).
 */
export function rewriteFocusToHash(search: string, hash: string): FocusRewrite | null {
  const parsed = parseFocusParam(search)
  if (!parsed) return null
  const featureId = focusToFeatureId(parsed.kind, parsed.slug)
  if (!featureId) return null
  const existingHash = hash.startsWith('#') ? hash.slice(1) : hash
  const hashParams = new URLSearchParams(existingHash)
  hashParams.set('feature', featureId)
  return { featureId, newHash: hashParams.toString() }
}

/**
 * One-shot URL rewriter: read `window.location.search` for `?focus=...`,
 * translate to `#feature=<id>` via {@link rewriteFocusToHash}, and rewrite
 * the URL via replaceState. Returns the resolved feature id (or null if no
 * focus param / unsupported kind). Idempotent: subsequent calls see no
 * `?focus=` and do nothing.
 *
 * Designed to run before `parseHash(window.location.hash)` is captured so
 * the existing deep-link flow (fly-to + select) picks up the spliced hash.
 */
export function consumeFocusParam(): string | null {
  if (typeof window === 'undefined') return null
  const rewrite = rewriteFocusToHash(window.location.search, window.location.hash)
  if (!rewrite) return null
  const newUrl = window.location.pathname + (rewrite.newHash ? `#${rewrite.newHash}` : '')
  window.history.replaceState(null, '', newUrl)
  return rewrite.featureId
}
