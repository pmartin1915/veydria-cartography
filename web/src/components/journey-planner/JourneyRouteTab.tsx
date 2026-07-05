import { IconScroll, IconMountain, IconArrow, IconWarning, IconCloudRain } from '../icons'
import { straitAnnotation, type JourneyRoute, type Season, type RouteMode } from '../../utils/journey-graph'
import { bearingDegrees, compass16, worldScale } from '../../utils/world-coords'
import { formatDays } from '../../utils/format-measure'
import { generateEncounters } from '../../utils/encounters'
import { computeModeRiskWarning } from '../../utils/journey-mode-risk'
import { computeEncounterDensityWarning } from '../../utils/journey-encounter-density'
import type { SupplyConfig } from '../../utils/journey-supply'
import NodeIcon from './NodeIcon'

interface JourneyRouteTabProps {
  route: JourneyRoute
  mode: RouteMode
  supply: SupplyConfig
  season: Season | undefined
  edgeBiomes: (string | undefined)[] | undefined
  shareMode: boolean
}

/**
 * The "Route" tab: bottlenecks, seasonal restrictions, the GM-only Mode-Risk
 * and Encounter-Density warnings, and the node-by-node path timeline.
 */
export default function JourneyRouteTab({ route, mode, supply, season, edgeBiomes, shareMode }: JourneyRouteTabProps) {
  const modeRisk = !shareMode ? computeModeRiskWarning(mode, supply) : null
  const densityWarning = !shareMode
    ? computeEncounterDensityWarning(mode, generateEncounters(route, season, mode, edgeBiomes))
    : null

  return (
    <>
      {/* Bottlenecks */}
      {route.bottlenecks.length > 0 && (
        <div className="journey-bottlenecks">
          <div className="journey-bottlenecks-title"><IconWarning /> Bottlenecks & Risks</div>
          {route.bottlenecks.map((b, i) => (
            <div key={i} className="journey-bottleneck">{b}</div>
          ))}
        </div>
      )}

      {route.bottlenecks.length === 0 && (
        <div className="journey-no-bottlenecks">✓ No major bottlenecks on this route</div>
      )}

      {/* Seasonal warnings */}
      {route.seasonalWarnings.length > 0 && (
        <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
          <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconCloudRain /> Seasonal Restrictions</div>
          {route.seasonalWarnings.map((w, i) => (
            <div key={i} className="journey-bottleneck">{w}</div>
          ))}
        </div>
      )}

      {/* Mode-risk warning (direct + caravan empirical risk) — GM only, hidden in share mode */}
      {modeRisk && (
        <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
          <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconWarning /> Mode Risk</div>
          <div className="journey-bottleneck">{modeRisk}</div>
        </div>
      )}

      {/* Encounter-density warning (sibling to mode risk) — GM only, hidden in share mode */}
      {densityWarning && (
        <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
          <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconWarning /> Encounter Density</div>
          <div className="journey-bottleneck">{densityWarning}</div>
        </div>
      )}

      {/* Path timeline */}
      <div className="journey-route-path">
        <div className="journey-path-line" />
        {route.nodes.map((node, i) => (
          <div key={node.id} className="journey-path-node">
            <div className={`journey-path-dot ${i === 0 ? 'start' : i === route.nodes.length - 1 ? 'end' : 'waypoint'}`} />
            <div className="journey-path-info">
              <span className="journey-path-name">
                <NodeIcon category={node.category} />
                {node.name}
              </span>
              {i < route.edges.length && (() => {
                const next = route.nodes[i + 1]
                const strait = straitAnnotation(node, next)
                const edge = route.edges[i]
                // Bearing is the straight chord between the two endpoints, not the
                // winding trade-route path — intentional for the route summary.
                const bearing = bearingDegrees({ x: node.x, y: node.y }, { x: next.x, y: next.y })
                const compass = compass16(bearing)
                const km = Math.round(edge.distanceSvg * worldScale.kmPerSvgUnit)
                const daysPart = edge.segmentDays !== undefined ? ` · ${formatDays(edge.segmentDays)}` : ''
                return (
                  <span className="journey-path-edge">
                    {edge.type === 'trade_route' && <IconScroll />}
                    {edge.type === 'chokepoint' && <IconMountain />}
                    {(edge.type === 'intra_civ' || edge.type === 'civ_link') && <IconArrow />}
                    {' '}{strait ? `⚓ ${strait} · ${edge.name}` : edge.name}
                    <span className="journey-path-edge-detail">{compass} · {km} km{daysPart}</span>
                  </span>
                )
              })()}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
