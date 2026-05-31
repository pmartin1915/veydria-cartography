import { NodeIcon as NodeIconSvg } from '../icons'

/** Small wrapper around the category glyph used in dropdowns and the path timeline. */
export default function NodeIcon({ category }: { category: string }) {
  return <span className="journey-node-icon"><NodeIconSvg category={category} /></span>
}
