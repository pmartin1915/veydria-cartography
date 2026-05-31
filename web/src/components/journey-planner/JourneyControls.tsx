import { type ReactNode } from 'react'
import {
  IconCalendar, IconFlower, IconSun, IconLeafFall, IconSnowflake,
} from '../icons'
import { generateEncounters } from '../../utils/encounters'
import { computeRecommendedMode } from '../../utils/journey-mode-recommend'
import { formatDayOfYear, CALENDAR_EVENT_COLORS, CALENDAR_EVENT_ICONS, type CalendarEventType } from '../../utils/calendar'
import type { JourneyRoute, Season, RouteMode, PartyConfig } from '../../utils/journey-graph'
import type { SupplyConfig } from '../../utils/journey-supply'
import PartyConfigBlock from './PartyConfig'
import SupplyConfigBlock from './SupplyConfig'

const SEASONS: { key: Season; label: string; icon: ReactNode }[] = [
  { key: 'spring', label: 'Spring', icon: <IconFlower /> },
  { key: 'summer', label: 'Summer', icon: <IconSun /> },
  { key: 'autumn', label: 'Autumn', icon: <IconLeafFall /> },
  { key: 'winter', label: 'Winter', icon: <IconSnowflake /> },
]

const MODES: { key: RouteMode; label: string; desc: string }[] = [
  { key: 'direct', label: 'Direct', desc: 'Shortest distance' },
  { key: 'fastest', label: 'Fastest', desc: 'Favour trade routes' },
  { key: 'safest', label: 'Safest', desc: 'Avoid chokepoints' },
  { key: 'cheapest', label: 'Cheapest', desc: 'Minimise tolls' },
]

interface JourneyControlsProps {
  season: Season | undefined
  onSeasonChange: (season: Season | undefined) => void
  mode: RouteMode
  onModeChange: (mode: RouteMode) => void
  shareMode: boolean
  route: JourneyRoute | null
  edgeBiomes: (string | undefined)[] | undefined
  party: PartyConfig
  partyOpen: boolean
  onTogglePartyOpen: () => void
  onPartyChange: (party: PartyConfig) => void
  supply: SupplyConfig
  supplyOpen: boolean
  onToggleSupplyOpen: () => void
  onSupplyChange: (supply: SupplyConfig) => void
  onFindRoute: () => void
  onClear: () => void
  findDisabled: boolean
  clearDisabled: boolean
  optionsOpen: boolean
  onToggleOptions: () => void
  compareMode: boolean
  onToggleCompare: () => void
  waypointsLength: number
  departureDayOfYear: number | undefined
  onSetDeparture: (day: number | undefined) => void
  highlightCrisisEvents: boolean
  onToggleHighlightCrisis: () => void
}

/**
 * The route-configuration controls below the endpoint pickers: season,
 * route-priority (mode), Find/Clear actions, and the collapsible "Party, supply
 * & options" drawer (party, supply, compare toggle, departure, calendar key).
 * Every shareMode / departure gate is preserved verbatim from the container.
 */
export default function JourneyControls({
  season, onSeasonChange,
  mode, onModeChange,
  shareMode,
  route, edgeBiomes,
  party, partyOpen, onTogglePartyOpen, onPartyChange,
  supply, supplyOpen, onToggleSupplyOpen, onSupplyChange,
  onFindRoute, onClear, findDisabled, clearDisabled,
  optionsOpen, onToggleOptions,
  compareMode, onToggleCompare, waypointsLength,
  departureDayOfYear, onSetDeparture,
  highlightCrisisEvents, onToggleHighlightCrisis,
}: JourneyControlsProps) {
  const recEncounters = (!shareMode && route)
    ? generateEncounters(route, season, mode, edgeBiomes)
    : []
  const rec = !shareMode ? computeRecommendedMode(mode, supply, recEncounters) : null

  return (
    <>
      {/* Season selector */}
      <div className="journey-seasons">
        <span className="journey-seasons-label">Season</span>
        <div className="journey-seasons-row">
          <button
            className={`journey-season-btn ${season === undefined ? 'active' : ''}`}
            onClick={() => onSeasonChange(undefined)}
            title="All seasons"
          >
            <IconCalendar /> Any
          </button>
          {SEASONS.map(s => (
            <button
              key={s.key}
              className={`journey-season-btn ${season === s.key ? 'active' : ''}`}
              onClick={() => onSeasonChange(s.key)}
              title={s.label}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Route mode selector — recommends `safest` (badge on the recommended
          button) when Mode Risk or Encounter Density predicates fire. GM-only;
          shareMode users see the bare selector. */}
      <div className="journey-modes">
        <span className="journey-modes-label">Route priority</span>
        <div className="journey-modes-row">
          {MODES.map(m => {
            const isRecommended = rec !== null && rec.mode === m.key && rec.mode !== mode
            return (
              <button
                key={m.key}
                className={`journey-mode-btn ${mode === m.key ? 'active' : ''} ${isRecommended ? 'recommended' : ''}`}
                onClick={() => onModeChange(m.key)}
                title={isRecommended ? `Recommended: ${rec!.reason}` : m.desc}
              >
                {m.label}
                {isRecommended && <span className="journey-mode-rec-badge">Recommended</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="journey-actions">
        <button
          className="journey-btn journey-btn--primary"
          onClick={onFindRoute}
          disabled={findDisabled}
        >
          Find Route
        </button>
        <button
          className="journey-btn"
          onClick={onClear}
          disabled={clearDisabled}
        >
          Clear
        </button>
      </div>

      {/* Party, supply & options — bulky config folded into a collapsed
          drawer so the primary route inputs + Route/Days/Encounters tabs
          surface without scrolling. Each inner section keeps its existing
          shareMode / departure gating unchanged. */}
      <div className="journey-options-drawer">
        <button
          type="button"
          className={`journey-options-header ${optionsOpen ? 'open' : ''}`}
          onClick={onToggleOptions}
          aria-expanded={optionsOpen}
        >
          <span className={`journey-options-chevron ${optionsOpen ? '' : 'collapsed'}`}>▾</span>
          <span className="journey-options-title">Party, supply &amp; options</span>
        </button>
        {optionsOpen && (
          <div className="journey-options-body">
            <PartyConfigBlock
              party={party}
              open={partyOpen}
              onToggleOpen={onTogglePartyOpen}
              onChange={onPartyChange}
            />

            <SupplyConfigBlock
              supply={supply}
              open={supplyOpen}
              onToggleOpen={onToggleSupplyOpen}
              onChange={onSupplyChange}
            />

            {/* Compare routes toggle */}
            {!shareMode && waypointsLength === 0 && (
              <div className="journey-compare-toggle">
                <button
                  className={`journey-compare-btn ${compareMode ? 'active' : ''}`}
                  onClick={onToggleCompare}
                  title="Overlay Direct, Safest, and Cheapest routes on the map"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 20V10M12 20V4M6 20v-6" />
                  </svg>
                  <span>Compare routes</span>
                </button>
              </div>
            )}

            {/* Departure day-of-year */}
            {!shareMode && (
              <div className="journey-departure">
                <label className="journey-departure-label">Departure</label>
                <div className="journey-departure-row">
                  <input
                    type="range"
                    min={1}
                    max={365}
                    value={departureDayOfYear ?? 1}
                    onChange={(e) => onSetDeparture(Number(e.target.value))}
                    className="journey-departure-slider"
                    disabled={departureDayOfYear === undefined}
                  />
                  <button
                    className={`journey-departure-toggle ${departureDayOfYear !== undefined ? 'active' : ''}`}
                    onClick={() => onSetDeparture(departureDayOfYear === undefined ? 120 : undefined)}
                    title={departureDayOfYear !== undefined ? 'Clear departure date' : 'Set departure date for calendar events'}
                  >
                    {departureDayOfYear !== undefined ? formatDayOfYear(departureDayOfYear) : 'Any'}
                  </button>
                </div>
              </div>
            )}

            {/* Calendar event legend */}
            {departureDayOfYear !== undefined && (
              <div className="journey-calendar-legend">
                <div className="journey-calendar-legend-header">
                  <span className="journey-calendar-legend-label">Event key</span>
                  <button
                    type="button"
                    className={`journey-calendar-legend-toggle ${highlightCrisisEvents ? 'active' : ''}`}
                    onClick={onToggleHighlightCrisis}
                    title="Highlight events that are crisis leverage windows"
                  >
                    ⚡ Crisis
                  </button>
                </div>
                <div className="journey-calendar-legend-grid">
                  {(Object.keys(CALENDAR_EVENT_COLORS) as CalendarEventType[]).map(type => (
                    <div key={type} className="journey-calendar-legend-item" title={type}>
                      <span className="journey-calendar-legend-dot" style={{ backgroundColor: CALENDAR_EVENT_COLORS[type] }} />
                      <span className="journey-calendar-legend-icon">{CALENDAR_EVENT_ICONS[type]}</span>
                      <span className="journey-calendar-legend-name">{type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
