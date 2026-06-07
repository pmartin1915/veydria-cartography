import type { Asterism } from '../utils/asterisms'

/**
 * MarginaliaCartouche — the always-visible corner name-plate of the ocean chart.
 *
 * Renders the single abstract cartouche device (asterisms.json, kind: cartouche):
 * the nakhoda chart-oath "By the star that watches", sworn on the pole star Serakar.
 * Pan/zoom-independent, sibling to the compass-rose / MapKey, so the marginalia
 * feature is discoverable at the default frame where the open-water margin (and so
 * the margin star-figures) is too thin to read.
 *
 * Canon rail (ADR-0023 Q3): a cartouche NAMES a figure but never DRAWS a deity —
 * the only glyph is a star (the watched pole), not a face/body/POV.
 */
export default function MarginaliaCartouche({
  cartouche,
  visible,
}: {
  cartouche: Asterism | null
  visible: boolean
}) {
  // Toggle hides it; a missing/failed load degrades silently (matching the
  // loader's failure-tolerance) rather than rendering an empty plate.
  if (!visible || !cartouche) return null

  return (
    <div className="marginalia-cartouche" data-testid="marginalia-cartouche" title={cartouche.gloss}>
      <svg
        className="marginalia-cartouche-frame"
        viewBox="0 0 168 52"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        aria-hidden
      >
        {/* Double-stroke name-plate frame — generic cartographic furniture. */}
        <rect x="3" y="3" width="162" height="46" rx="6" strokeOpacity="0.55" />
        <rect x="6" y="6" width="156" height="40" rx="4" strokeOpacity="0.28" />
        {/* The watched pole: a star glyph (NOT a figure), left of the plate. */}
        <g transform="translate(22 26)" strokeOpacity="0.85">
          <path
            d="M0 -8 L1.9 -1.9 L8 0 L1.9 1.9 L0 8 L-1.9 1.9 L-8 0 L-1.9 -1.9 Z"
            fill="currentColor"
            fillOpacity="0.8"
            stroke="none"
          />
          <circle cx="0" cy="0" r="11" strokeOpacity="0.25" strokeDasharray="2 2.5" />
        </g>
      </svg>
      <span className="marginalia-cartouche-label">{cartouche.prose_label}</span>
    </div>
  )
}
