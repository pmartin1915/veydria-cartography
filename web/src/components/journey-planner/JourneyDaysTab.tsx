import { buildDailyBreakdown } from '../../utils/journey-days'
import { computeSupplyTimeline, type SupplyConfig, type SupplyDay } from '../../utils/journey-supply'
import { formatDayOfYear, CALENDAR_EVENT_COLORS, hasCrisis, formatCrisisRef } from '../../utils/calendar'
import { encounterTypeIcon, encounterSeverityLabel } from '../../utils/encounters'
import type { JourneyRoute, Season, RouteMode, PartyConfig } from '../../utils/journey-graph'
import { IconCloudRain, IconPin } from '../icons'

interface JourneyDaysTabProps {
  route: JourneyRoute
  season: Season | undefined
  mode: RouteMode
  edgeBiomes: (string | undefined)[] | undefined
  departureDayOfYear: number | undefined
  party: PartyConfig
  supply: SupplyConfig
  shareMode: boolean
  highlightCrisisEvents: boolean
  onSelectSegment: (idx: number) => void
  onSwitchToEncounters: () => void
}

export default function JourneyDaysTab({
  route,
  season,
  mode,
  edgeBiomes,
  departureDayOfYear,
  party,
  supply,
  shareMode,
  highlightCrisisEvents,
  onSelectSegment,
  onSwitchToEncounters,
}: JourneyDaysTabProps) {
  const days = buildDailyBreakdown(route, season, mode, edgeBiomes, departureDayOfYear, party)
  if (days.length === 0) {
    return <div className="journey-encounters-empty">Trip too short to break into days. See the Route tab.</div>
  }
  const biomeForEdge = edgeBiomes
    ? (e: typeof route.edges[number]) => edgeBiomes[route.edges.indexOf(e)]
    : undefined
  const supplyTimeline = computeSupplyTimeline(days, party, supply, biomeForEdge, season)
  const supplyByDay = new Map<number, SupplyDay>(supplyTimeline.map(s => [s.dayNum, s]))

  return (
    <div className="journey-days">
      <div className="journey-encounters-header">
        <span className="journey-encounters-count">{days.length} day{days.length !== 1 ? 's' : ''}</span>
        <span className="journey-encounters-seed">Deterministic by route + season</span>
      </div>
      {days.map((day) => {
        const primarySegmentIdx = day.edgesTraversed.length > 0
          ? route.edges.findIndex(e => e === day.edgesTraversed[0].edge)
          : 0
        const supplyDay = supplyByDay.get(day.dayNum)
        return (
          <div
            key={day.dayNum}
            className="journey-day"
            onClick={() => {
              if (route.edges.length > 1) {
                onSwitchToEncounters()
                onSelectSegment(Math.max(0, primarySegmentIdx))
              }
            }}
            title={route.edges.length > 1 ? 'Click to view this day\'s segment in Encounters' : undefined}
          >
            <div className="journey-day-header">
              <span className="journey-day-num">Day {day.dayNum}</span>
              {day.dayOfYear !== undefined && (
                <span className="journey-day-doy">{formatDayOfYear(day.dayOfYear)}</span>
              )}
              <span className="journey-day-km">{Math.round(day.kmCovered)} km</span>
            </div>
            <div className="journey-day-line"><span className="journey-day-label">Start:</span> {day.startLabel}</div>
            <div className="journey-day-line journey-day-weather"><IconCloudRain /> {day.weather}</div>
            {day.calendarEvents && day.calendarEvents.length > 0 && (
              <div className="journey-day-calendar">
                {day.calendarEvents.map((ev, i) => {
                  const crisis = hasCrisis(ev)
                  const dimmed = highlightCrisisEvents && !crisis
                  return (
                    <div
                      key={i}
                      className={`journey-calendar-event ${dimmed ? 'dimmed' : ''} ${crisis ? 'crisis' : ''}`}
                      style={{ borderLeftColor: CALENDAR_EVENT_COLORS[ev.type] }}
                      title={ev.description + (ev.effect ? `\nEffect: ${ev.effect}` : '') + (ev.crises ? '\nCrisis: ' + ev.crises.map(formatCrisisRef).join(', ') : '')}
                    >
                      <span className="journey-calendar-event-dot" style={{ backgroundColor: CALENDAR_EVENT_COLORS[ev.type] }} />
                      <span className="journey-calendar-event-name">{ev.name}</span>
                      {crisis && <span className="journey-calendar-event-crisis">⚡</span>}
                      {ev.civilization !== 'all' && (
                        <span className="journey-calendar-event-civ">{ev.civilization}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {day.notable.length > 0 && (
              <ul className="journey-day-notable">
                {day.notable.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {!shareMode && day.encounters.length > 0 && (
              <div className="journey-day-encounters">
                {day.encounters.map((enc, i) => (
                  <div key={i} className={`journey-encounter ${enc.severity}`}>
                    <div className="journey-encounter-meta">
                      <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
                      <span className="journey-encounter-type">{enc.type}</span>
                      <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
                      {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
                    </div>
                    <div className="journey-encounter-beat">{enc.beat}</div>
                  </div>
                ))}
              </div>
            )}
            {supplyDay && (
              <div className={`journey-day-line journey-day-supply ${supplyDay.warning ?? ''}`}>
                <span className="journey-day-label">Supply:</span>{' '}
                Rations {Math.max(0, Math.floor(supplyDay.rationsLeft))}d
                {' · '}
                Water {Math.max(0, Math.floor(supplyDay.waterLeft))}d
                {supplyDay.warning && (
                  <span className="journey-day-supply-warn">
                    {' — '}
                    {supplyDay.warning === 'water-out' ? 'water exhausted'
                      : supplyDay.warning === 'rations-out' ? 'rations exhausted'
                      : supplyDay.warning === 'water-low' ? 'water critical'
                      : 'rations critical'}
                  </span>
                )}
              </div>
            )}
            <div className="journey-day-line journey-day-camp"><IconPin /> {day.campLabel}</div>
          </div>
        )
      })}
    </div>
  )
}
