import {
  isDefaultSupply,
  type SupplyConfig as SupplyConfigType,
  type Encumbrance,
  type PackAnimals,
} from '../../utils/journey-supply'
import { IconScroll } from '../icons'

interface SupplyConfigProps {
  supply: SupplyConfigType
  open: boolean
  onToggleOpen: () => void
  onChange: (next: SupplyConfigType) => void
}

export default function SupplyConfig({ supply, open, onToggleOpen, onChange }: SupplyConfigProps) {
  return (
    <div className="journey-supply">
      <button
        className={`journey-supply-toggle ${open ? 'active' : ''}`}
        onClick={onToggleOpen}
        title="Configure rations, water, encumbrance, and pack animals"
      >
        <IconScroll />
        <span>Supply</span>
        <span className="journey-supply-summary">
          {isDefaultSupply(supply)
            ? 'default'
            : [
                `${supply.rationsPerPerson}d rations`,
                `${supply.waterPerPerson}d water`,
                supply.encumbrance !== 'normal' ? `${supply.encumbrance} load` : null,
                supply.packAnimals !== 'none' ? `pack: ${supply.packAnimals}` : null,
              ].filter(Boolean).join(' · ')}
        </span>
        <span className="journey-supply-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="journey-supply-body">
          <div className="journey-supply-row">
            <span className="journey-supply-label">Rations / person</span>
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              className="journey-supply-number"
              value={supply.rationsPerPerson}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n) && n >= 0 && n <= 99) {
                  onChange({ ...supply, rationsPerPerson: n })
                }
              }}
              title="Days of rations each traveller carries at depart"
            />
          </div>
          <div className="journey-supply-row">
            <span className="journey-supply-label">Water / person</span>
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              className="journey-supply-number"
              value={supply.waterPerPerson}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n) && n >= 0 && n <= 99) {
                  onChange({ ...supply, waterPerPerson: n })
                }
              }}
              title="Days of water each traveller carries at depart"
            />
          </div>
          <div className="journey-supply-row">
            <span className="journey-supply-label">Encumbrance</span>
            <div className="journey-modes-row">
              {(['light', 'normal', 'heavy'] as Encumbrance[]).map(enc => (
                <button
                  key={enc}
                  className={`journey-mode-btn ${supply.encumbrance === enc ? 'active' : ''}`}
                  onClick={() => onChange({ ...supply, encumbrance: enc })}
                  title={enc === 'light' ? '−10% burn rate' : enc === 'heavy' ? '+10% burn rate' : 'Standard load'}
                >
                  {enc}
                </button>
              ))}
            </div>
          </div>
          <div className="journey-supply-row">
            <span className="journey-supply-label">Pack animals</span>
            <div className="journey-modes-row">
              {(['none', 'few', 'caravan'] as PackAnimals[]).map(pa => (
                <button
                  key={pa}
                  className={`journey-mode-btn ${supply.packAnimals === pa ? 'active' : ''}`}
                  onClick={() => onChange({ ...supply, packAnimals: pa })}
                  title={pa === 'few' ? '+3 days of capacity' : pa === 'caravan' ? '+7 days of capacity' : 'No animals'}
                >
                  {pa}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
