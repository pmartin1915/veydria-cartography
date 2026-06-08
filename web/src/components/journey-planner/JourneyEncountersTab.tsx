import { IconScroll, IconMountain, IconArrow } from '../icons'
import {
  encounterTypeIcon,
  encounterSeverityLabel,
  type Encounter,
} from '../../utils/encounters'
import { rollOneOff } from '../../utils/encounter-roller'
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_GLYPH } from '../../utils/time-of-day'
import type { JourneyRoute, Season, RouteMode } from '../../utils/journey-graph'

interface JourneyEncountersTabProps {
  route: JourneyRoute
  /** Generated once in the container (shared with the vignette) so the tab and the
   *  vignette agree on the same deterministic draw. */
  encounters: Encounter[]
  season: Season | undefined
  mode: RouteMode
  edgeBiomes: (string | undefined)[] | undefined
  selectedBiome: string | null
  selectedSegmentIdx: number
  onSelectSegment: (idx: number) => void
  oneOffRolls: Encounter[]
  onRollOneOff: (enc: Encounter) => void
}

/**
 * The "Encounters" tab: the generated beat list, per-segment chips, and the
 * impromptu "Roll one-off" control. GM-only — the container gates rendering on
 * `!shareMode`. Impromptu rolls + the selected segment are lifted to the
 * container (DaysTab can drive the selected segment), so they arrive as props.
 */
export default function JourneyEncountersTab({
  route,
  encounters,
  season,
  mode,
  edgeBiomes,
  selectedBiome,
  selectedSegmentIdx,
  onSelectSegment,
  oneOffRolls,
  onRollOneOff,
}: JourneyEncountersTabProps) {
  const activeEdge = route.edges[selectedSegmentIdx] ?? route.edges[0]

  const handleRoll = () => {
    if (route.edges.length === 0) return
    const edge = route.edges[selectedSegmentIdx] ?? route.edges[0]
    const edgeType = edge.type === 'civ_link' ? 'intra_civ' : edge.type as 'trade_route' | 'chokepoint' | 'intra_civ'
    const biome = edgeBiomes?.[selectedSegmentIdx] || selectedBiome || undefined
    const rolled = rollOneOff({ edgeType, season, biome })
    if (rolled) onRollOneOff(rolled)
  }

  return (
    <div className="journey-encounters">
      <div className="journey-encounters-header">
        <span className="journey-encounters-count">
          {encounters.length} beat{encounters.length !== 1 ? 's' : ''}
          {oneOffRolls.length > 0 && ` + ${oneOffRolls.length} impromptu`}
        </span>
        <button
          type="button"
          className="journey-encounter-roll-btn"
          onClick={handleRoll}
          title={`Roll for ${activeEdge?.name ?? 'current segment'} (${activeEdge?.type.replace('_', '-') ?? 'unknown'})`}
        >
          ⟳ Roll one-off
        </button>
      </div>
      {route.edges.length > 1 && (
        <div className="journey-segment-chips">
          {route.edges.map((edge, i) => (
            <button
              key={i}
              type="button"
              className={`journey-segment-chip ${i === selectedSegmentIdx ? 'active' : ''}`}
              onClick={() => onSelectSegment(i)}
              title={`${edge.name} (${edge.type.replace('_', '-')})`}
            >
              {edge.type === 'trade_route' && <IconScroll />}
              {edge.type === 'chokepoint' && <IconMountain />}
              {(edge.type === 'intra_civ' || edge.type === 'civ_link') && <IconArrow />}
              <span className="journey-segment-chip-label">{edge.name}</span>
            </button>
          ))}
        </div>
      )}
      {oneOffRolls.map((enc, i) => (
        <div key={`oneoff-${oneOffRolls.length - i}`} className={`journey-encounter journey-encounter--impromptu ${enc.severity}`}>
          <div className="journey-encounter-meta">
            <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
            <span className="journey-encounter-type">{enc.type}</span>
            <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
            {enc.timeOfDay !== 'day' && (
              <span className={`journey-encounter-time ${enc.timeOfDay}`}>{TIME_OF_DAY_GLYPH[enc.timeOfDay]} {TIME_OF_DAY_LABELS[enc.timeOfDay]}</span>
            )}
            {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
            <span className="journey-encounter-segment journey-encounter-segment--impromptu">Impromptu</span>
          </div>
          <div className="journey-encounter-beat">{enc.beat}</div>
        </div>
      ))}
      {encounters.length === 0 && oneOffRolls.length === 0 && (
        <div className="journey-encounters-empty">No encounters generated. Try Roll one-off.</div>
      )}
      {encounters.map((enc, i) => (
        <div key={i} className={`journey-encounter ${enc.severity}`}>
          <div className="journey-encounter-meta">
            <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
            <span className="journey-encounter-type">{enc.type}</span>
            <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
            {enc.timeOfDay !== 'day' && (
              <span className={`journey-encounter-time ${enc.timeOfDay}`}>{TIME_OF_DAY_GLYPH[enc.timeOfDay]} {TIME_OF_DAY_LABELS[enc.timeOfDay]}</span>
            )}
            {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
            {route.edges[enc.segmentIdx] && (
              <span className="journey-encounter-segment">{route.edges[enc.segmentIdx].name}</span>
            )}
          </div>
          <div className="journey-encounter-beat">{enc.beat}</div>
        </div>
      ))}
    </div>
  )
}
