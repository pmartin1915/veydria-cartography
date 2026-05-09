import type { HexCell } from '../utils/hex-grid'
import { hexNeighbors, labelHex } from '../utils/hex-grid'

interface Props {
  hex: HexCell
  descriptors: string[]
  onClose: () => void
  onCentre?: () => void
}

export default function HexInfoPanel({ hex, descriptors, onClose, onCentre }: Props) {
  const neighbours = hexNeighbors(hex.coord).map(labelHex)
  return (
    <aside className="hex-info-panel" role="dialog" aria-label={`Hex ${hex.label}`}>
      <header className="hex-info-panel-header">
        <span className="hex-info-panel-coord">{hex.label}</span>
        <div className="hex-info-panel-actions">
          {onCentre && (
            <button
              type="button"
              className="hex-info-panel-action"
              onClick={onCentre}
              aria-label={`Centre map on hex ${hex.label}`}
              title="Centre on hex"
            >
              ⊙
            </button>
          )}
          <button type="button" className="hex-info-panel-close" onClick={onClose} aria-label="Close hex panel">×</button>
        </div>
      </header>
      <div className="hex-info-panel-body">
        <div className="hex-info-panel-row">
          <span className="hex-info-panel-key">Terrain</span>
          <span className="hex-info-panel-val">
            {descriptors.length > 0 ? descriptors.join(', ') : 'Open Sea'}
          </span>
        </div>
        <div className="hex-info-panel-row">
          <span className="hex-info-panel-key">Neighbours</span>
          <span className="hex-info-panel-val hex-info-panel-neighbours">
            {neighbours.join(' · ')}
          </span>
        </div>
      </div>
    </aside>
  )
}
