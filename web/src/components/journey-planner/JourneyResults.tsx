import { getRouteDifficulty, describeParty, type JourneyRoute, type RouteMode, type ComparisonRoutes, type PartyConfig, type JourneyNode } from '../../utils/journey-graph'
import { formatDistance } from '../../utils/measure'
import { formatDays } from '../../utils/journey-export'
import { modeBurnMultipliers } from '../../utils/journey-supply'

/** Per-mode daily-ration burn delta vs the baseline (1×), as a signed percent
 *  string for the comparison cards. The mechanical counterpart to "fewer days":
 *  direct travels shortest but burns most per day; safest is the reverse. */
function burnPctLabel(mode: RouteMode): string {
  const pct = Math.round((modeBurnMultipliers(mode).rations - 1) * 100)
  if (pct === 0) return 'baseline'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

interface JourneyResultsProps {
  route: JourneyRoute
  mode: RouteMode
  compareMode: boolean
  comparisonRoutes: ComparisonRoutes
  party: PartyConfig
  onSwitchMode: (mode: RouteMode) => void
  routeHexLabels: string[]
  autoPivots: JourneyNode[]
  onSetOut?: () => void
}

/**
 * Route summary block: distance/travel/segments stats, difficulty badge, the
 * optional Direct/Safest/Cheapest comparison cards, the hex path, and the
 * auto-pivot note. Clicking a comparison card switches the active mode.
 */
export default function JourneyResults({
  route,
  mode,
  compareMode,
  comparisonRoutes,
  party,
  onSwitchMode,
  routeHexLabels,
  autoPivots,
  onSetOut,
}: JourneyResultsProps) {
  const diff = getRouteDifficulty(route)

  return (
    <>
      <div className="journey-route-stats">
        <div className="journey-stat">
          <span className="journey-stat-label">Distance</span>
          <span className="journey-stat-value">{formatDistance(route.totalDistanceSvg)}</span>
        </div>
        <div className="journey-stat">
          <span className="journey-stat-label">Est. Travel</span>
          <span className="journey-stat-value" data-testid="est-days">{formatDays(route.estimatedDays)}</span>
        </div>
        <div className="journey-stat">
          <span className="journey-stat-label">Segments</span>
          <span className="journey-stat-value">{route.edges.length}</span>
        </div>
      </div>
      <div className="journey-difficulty">
        <span className={`journey-difficulty-badge ${diff.class}`}>{diff.label}</span>
        {onSetOut && (
          <button
            className="journey-set-out-btn"
            onClick={onSetOut}
            title="Begin the day-by-day passage"
            data-testid="set-out-btn"
          >
            Set out
          </button>
        )}
      </div>

      {/* Comparison stats: side-by-side Direct / Safest / Cheapest */}
      {compareMode && comparisonRoutes && (
        <div className="journey-comparison-stats">
          {(() => {
            const entries = [
              { key: 'direct' as const, label: 'Direct', color: '#4a9a3a', route: comparisonRoutes.direct },
              { key: 'safest' as const, label: 'Safest', color: '#3a7ca5', route: comparisonRoutes.safest },
              { key: 'cheapest' as const, label: 'Cheapest', color: '#c4a862', route: comparisonRoutes.cheapest },
            ]
            const valid = entries.filter(e => e.route)
            const bestDistance = valid.length > 0 ? Math.min(...valid.map(e => e.route!.totalDistanceSvg)) : Infinity
            const bestDays = valid.length > 0 ? Math.min(...valid.map(e => e.route!.estimatedDays)) : Infinity
            const bestSegments = valid.length > 0 ? Math.min(...valid.map(e => e.route!.edges.length)) : Infinity
            const bestBurn = Math.min(...entries.map(e => modeBurnMultipliers(e.key).rations))
            return entries.map(({ key, label, color, route: cr }) => (
              <div
                key={key}
                className={`journey-comparison-card ${key === mode ? 'journey-comparison-active' : ''}`}
                style={{ '--comparison-color': color } as React.CSSProperties}
                onClick={() => {
                  if (cr && key !== mode) onSwitchMode(key as RouteMode)
                }}
                title={cr ? `Switch to ${label} route — ${describeParty(party) || 'default party (on foot)'} · burns ${burnPctLabel(key)} rations/day` : 'No route found'}
              >
                <div className="journey-comparison-card-header">
                  <span className="journey-comparison-dot" style={{ backgroundColor: color }} />
                  <span className="journey-comparison-label">{label}</span>
                  {key === mode && <span className="journey-comparison-current">active</span>}
                </div>
                {cr ? (
                  <div className="journey-comparison-card-body">
                    <div className="journey-comparison-stat">
                      <span className="journey-comparison-stat-label">Distance</span>
                      <span className="journey-comparison-stat-value">
                        {formatDistance(cr.totalDistanceSvg)}
                        {cr.totalDistanceSvg === bestDistance && (
                          <span className="journey-comparison-trophy" title="Shortest distance">★</span>
                        )}
                      </span>
                    </div>
                    <div className="journey-comparison-stat">
                      <span className="journey-comparison-stat-label">Travel</span>
                      <span className="journey-comparison-stat-value">
                        {formatDays(cr.estimatedDays)}
                        {cr.estimatedDays === bestDays && (
                          <span className="journey-comparison-trophy" title="Fastest route">★</span>
                        )}
                      </span>
                    </div>
                    <div className="journey-comparison-stat">
                      <span className="journey-comparison-stat-label">Segments</span>
                      <span className="journey-comparison-stat-value">
                        {cr.edges.length}
                        {cr.edges.length === bestSegments && (
                          <span className="journey-comparison-trophy" title="Fewest segments">★</span>
                        )}
                      </span>
                    </div>
                    <div className="journey-comparison-stat">
                      <span className="journey-comparison-stat-label">Supply/day</span>
                      <span className="journey-comparison-stat-value">
                        {burnPctLabel(key)}
                        {modeBurnMultipliers(key).rations === bestBurn && (
                          <span className="journey-comparison-trophy" title="Lowest daily burn">★</span>
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="journey-comparison-no-route">No route</div>
                )}
              </div>
            ))
          })()}
        </div>
      )}

      {routeHexLabels.length > 0 && (
        <div className="journey-route-hexes">
          <span className="journey-route-hexes-label">Hex path</span>
          <span className="journey-route-hexes-value">{routeHexLabels.join(' → ')}</span>
          <span className="journey-route-hexes-count">{routeHexLabels.length} hex{routeHexLabels.length !== 1 ? 'es' : ''}</span>
        </div>
      )}

      {autoPivots.length > 0 && (
        <div className="journey-auto-pivot">
          No direct route — auto-routed via {autoPivots.map(p => p.name).join(' and ')}.
        </div>
      )}
    </>
  )
}
